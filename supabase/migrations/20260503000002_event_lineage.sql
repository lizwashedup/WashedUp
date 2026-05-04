-- Event lineage: forward-link a duplicate plan to the one it was duplicated
-- from, so the feed can group siblings into a "popular plan" cluster and so
-- joining one plan can drop the user from the waitlists of its siblings.
--
-- Three pieces:
--   1. Column events.duplicated_from_event_id (+ partial index).
--   2. Helper get_plan_lineage(uuid) → uuid[] used by the waitlist trigger.
--   3. AFTER INSERT trigger on event_members that removes a freshly-joined
--      user from the waitlists of every OTHER plan in the lineage.
--
-- Cluster detection itself is NOT in this migration — it lives in
-- get_filtered_feed (next migration) via a window function so that "cluster
-- of 1 due to per-user filters" collapses to NULL at the SQL layer.
--
-- Prefer-separate-triggers rule: this is a brand-new trigger on event_members,
-- not a modification of any existing one.

-- ────────────────────────────────────────────────────────────────────
-- 1. Column + index
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS duplicated_from_event_id uuid
  REFERENCES events(id) ON DELETE SET NULL;

COMMENT ON COLUMN events.duplicated_from_event_id IS
  'Set when this plan was created via the "post a duplicate hangout" flow. Forms a tree (root = NULL, leaves point at parents). Walk via get_plan_lineage(). ON DELETE SET NULL so deleting an ancestor breaks the chain rather than orphaning descendants.';

CREATE INDEX IF NOT EXISTS idx_events_duplicated_from
  ON events(duplicated_from_event_id)
  WHERE duplicated_from_event_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 2. Lineage helper
-- ────────────────────────────────────────────────────────────────────
-- Walks UP to the root of the family tree, then DOWN from the root, so it
-- returns every event in the same tree regardless of which member you start
-- from. STABLE since events are immutable enough within a single statement
-- for query planning. Used by the waitlist trigger below; the feed query
-- inlines its own (filter-aware) version.
CREATE OR REPLACE FUNCTION public.get_plan_lineage(p_event_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH RECURSIVE up AS (
    SELECT id, duplicated_from_event_id
    FROM events WHERE id = p_event_id
    UNION ALL
    SELECT e.id, e.duplicated_from_event_id
    FROM events e
    JOIN up ON e.id = up.duplicated_from_event_id
  ),
  root AS (
    SELECT id FROM up WHERE duplicated_from_event_id IS NULL
  ),
  down AS (
    SELECT id FROM root
    UNION ALL
    SELECT e.id
    FROM events e
    JOIN down ON e.duplicated_from_event_id = down.id
  )
  SELECT array_agg(DISTINCT id) FROM down;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 3. Waitlist removal trigger on event_members
-- ────────────────────────────────────────────────────────────────────
-- When a user joins a plan that's part of a lineage, drop them from the
-- waitlist of every OTHER plan in that lineage. Spec: joining the duplicate
-- frees you from waiting on the original (and any siblings).
--
-- Bails out early when:
--   - The new row isn't a join (status != 'joined'). Covers role='host' inserts
--     by the creator, declined invites, etc.
--   - The event isn't in a lineage at all (no parent, no children). Covers
--     the common case of standalone plans without paying for a lineage walk.
CREATE OR REPLACE FUNCTION public.remove_from_lineage_waitlists()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_in_lineage boolean;
BEGIN
  IF NEW.status <> 'joined' THEN
    RETURN NEW;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM events
      WHERE id = NEW.event_id AND duplicated_from_event_id IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM events
      WHERE duplicated_from_event_id = NEW.event_id
    )
  INTO v_in_lineage;

  IF NOT v_in_lineage THEN
    RETURN NEW;
  END IF;

  DELETE FROM event_waitlist
  WHERE user_id = NEW.user_id
    AND event_id = ANY(get_plan_lineage(NEW.event_id))
    AND event_id <> NEW.event_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_remove_from_lineage_waitlists ON event_members;
CREATE TRIGGER trg_remove_from_lineage_waitlists
  AFTER INSERT ON event_members
  FOR EACH ROW
  EXECUTE FUNCTION remove_from_lineage_waitlists();

-- ────────────────────────────────────────────────────────────────────
-- Self-tests (Supabase branches are broken, embedded checks substitute)
-- ────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_column_exists boolean;
  v_index_exists boolean;
  v_lineage_fn_exists boolean;
  v_trigger_fn_exists boolean;
  v_trigger_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'duplicated_from_event_id'
  ) INTO v_column_exists;
  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'self-test failed: events.duplicated_from_event_id column missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'events'
      AND indexname = 'idx_events_duplicated_from'
  ) INTO v_index_exists;
  IF NOT v_index_exists THEN
    RAISE EXCEPTION 'self-test failed: idx_events_duplicated_from missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_plan_lineage'
  ) INTO v_lineage_fn_exists;
  IF NOT v_lineage_fn_exists THEN
    RAISE EXCEPTION 'self-test failed: get_plan_lineage function missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'remove_from_lineage_waitlists'
  ) INTO v_trigger_fn_exists;
  IF NOT v_trigger_fn_exists THEN
    RAISE EXCEPTION 'self-test failed: remove_from_lineage_waitlists function missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'event_members'
      AND t.tgname = 'trg_remove_from_lineage_waitlists'
  ) INTO v_trigger_exists;
  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'self-test failed: trg_remove_from_lineage_waitlists trigger missing on event_members';
  END IF;
END
$do$;
