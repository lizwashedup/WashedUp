-- Lineage security + robustness pass.
--
-- Four fixes from the audit on the prior cluster + duplication migrations:
--
--   1. Cycle guard on events.duplicated_from_event_id. ON DELETE SET NULL
--      already prevents most cycles, but a stray UPDATE could create A→B→A
--      and freeze every feed query (recursive CTE never terminates).
--      Fix: CHECK (id != duplicated_from_event_id) so a row can't reference
--      itself, AND switch UNION ALL → UNION in both recursive CTEs so any
--      future cycle dedupes-out and terminates rather than spinning.
--
--   2. Re-join path missed by the waitlist-removal trigger. join_event_atomic
--      RPC (verified live on prod) UPDATEs an existing event_members row
--      first and only INSERTs if NOT FOUND. The AFTER INSERT trigger from
--      the prior migration never fires for that path. Add a separate
--      AFTER UPDATE trigger calling the same function (keeps the "prefer
--      separate triggers" rule).
--
--   3. notify_waitlist_duplicate_plan was spoofable: it trusted
--      p_creator_user_id verbatim, so any authenticated user could fan
--      forged "Bob just posted..." notifications under another user's
--      name. Fix: keep the same 3-param signature (so the existing client
--      call works unchanged), but inside the function:
--         a) require auth.uid() = p_creator_user_id
--         b) require events.creator_user_id = p_creator_user_id for p_new_event_id
--         c) require events.duplicated_from_event_id = p_original_event_id
--      All three checks RETURN silently on failure (no error leak).
--
--   4. Migration self-tests for the changes above.
--
-- All changes are safe against current prod data:
--   - 0 rows currently have duplicated_from_event_id set (verified live);
--     the CHECK constraint cannot fail.
--   - UNION vs UNION ALL is byte-identical when no cycles exist (also
--     true today since no rows have non-null parents yet).
--   - UPDATE trigger only fires on a status transition that didn't
--     previously cause notification fanout, so no double-fire risk.

-- ────────────────────────────────────────────────────────────────────
-- 1a. CHECK constraint preventing self-cycles
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_no_self_lineage;

ALTER TABLE events
  ADD CONSTRAINT events_no_self_lineage
  CHECK (duplicated_from_event_id IS NULL OR duplicated_from_event_id <> id);

-- ────────────────────────────────────────────────────────────────────
-- 1b. UNION-deduped lineage helpers (cycle resilience)
-- ────────────────────────────────────────────────────────────────────
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
    UNION
    SELECT e.id, e.duplicated_from_event_id
    FROM events e
    JOIN up ON e.id = up.duplicated_from_event_id
  ),
  root AS (
    SELECT id FROM up WHERE duplicated_from_event_id IS NULL
  ),
  down AS (
    SELECT id FROM root
    UNION
    SELECT e.id
    FROM events e
    JOIN down ON e.duplicated_from_event_id = down.id
  )
  SELECT array_agg(DISTINCT id) FROM down;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_root(p_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH RECURSIVE up AS (
    SELECT id, duplicated_from_event_id FROM events WHERE id = p_event_id
    UNION
    SELECT e.id, e.duplicated_from_event_id
    FROM events e
    JOIN up ON e.id = up.duplicated_from_event_id
  )
  SELECT id FROM up WHERE duplicated_from_event_id IS NULL;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 2. AFTER UPDATE branch for the waitlist-removal trigger
--    Same function, separate trigger (per "prefer separate triggers").
-- ────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_remove_from_lineage_waitlists_on_update ON event_members;
CREATE TRIGGER trg_remove_from_lineage_waitlists_on_update
  AFTER UPDATE OF status ON event_members
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'joined' AND NEW.status = 'joined')
  EXECUTE FUNCTION remove_from_lineage_waitlists();

-- ────────────────────────────────────────────────────────────────────
-- 3. Auth check on notify_waitlist_duplicate_plan
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_waitlist_duplicate_plan(
  p_original_event_id uuid,
  p_new_event_id uuid,
  p_creator_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_creator_name text;
  v_original_title text;
  v_actual_creator uuid;
  v_actual_parent uuid;
  v_waitlist_user record;
BEGIN
  -- Defensive validation. All checks silent-return so we don't leak
  -- info about which event ids exist or which users created them.
  -- Tested via PostgREST: auth.uid() returns the JWT's sub claim.
  IF auth.uid() IS DISTINCT FROM p_creator_user_id THEN
    RETURN;
  END IF;

  SELECT creator_user_id, duplicated_from_event_id
  INTO v_actual_creator, v_actual_parent
  FROM events
  WHERE id = p_new_event_id;

  IF v_actual_creator IS DISTINCT FROM p_creator_user_id THEN
    RETURN;
  END IF;

  IF v_actual_parent IS DISTINCT FROM p_original_event_id THEN
    RETURN;
  END IF;

  -- Validation passed. Fan notifications.
  SELECT first_name_display INTO v_creator_name
  FROM profiles WHERE id = p_creator_user_id;

  SELECT title INTO v_original_title
  FROM events WHERE id = p_original_event_id;

  FOR v_waitlist_user IN
    SELECT user_id
    FROM event_waitlist
    WHERE event_id = p_original_event_id
      AND user_id != p_creator_user_id
  LOOP
    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    VALUES (
      v_waitlist_user.user_id,
      'duplicate_plan',
      'no need to wait!',
      COALESCE(v_creator_name, 'someone') || ' just posted a similar plan to "' || COALESCE(v_original_title, 'a plan') || '". join now instead of waiting!',
      p_new_event_id
    );
  END LOOP;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- Self-tests
-- ────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_constraint_exists boolean;
  v_def text;
  v_update_trigger_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'events_no_self_lineage'
  ) INTO v_constraint_exists;
  IF NOT v_constraint_exists THEN
    RAISE EXCEPTION 'self-test failed: events_no_self_lineage CHECK constraint missing';
  END IF;

  SELECT pg_get_functiondef('public.get_plan_lineage(uuid)'::regprocedure) INTO v_def;
  IF position('UNION ALL' IN v_def) > 0 THEN
    RAISE EXCEPTION 'self-test failed: get_plan_lineage still uses UNION ALL (cycle-vulnerable)';
  END IF;
  IF position('UNION' IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-test failed: get_plan_lineage missing UNION (recursion would never terminate)';
  END IF;

  SELECT pg_get_functiondef('public.get_event_root(uuid)'::regprocedure) INTO v_def;
  IF position('UNION ALL' IN v_def) > 0 THEN
    RAISE EXCEPTION 'self-test failed: get_event_root still uses UNION ALL (cycle-vulnerable)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'event_members'
      AND t.tgname = 'trg_remove_from_lineage_waitlists_on_update'
  ) INTO v_update_trigger_exists;
  IF NOT v_update_trigger_exists THEN
    RAISE EXCEPTION 'self-test failed: trg_remove_from_lineage_waitlists_on_update missing on event_members';
  END IF;

  SELECT pg_get_functiondef('public.notify_waitlist_duplicate_plan(uuid,uuid,uuid)'::regprocedure) INTO v_def;
  IF position('auth.uid() IS DISTINCT FROM p_creator_user_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-test failed: notify_waitlist_duplicate_plan missing auth.uid() identity check (still spoofable)';
  END IF;
  IF position('v_actual_creator IS DISTINCT FROM p_creator_user_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-test failed: notify_waitlist_duplicate_plan missing creator-of-new-event validation';
  END IF;
  IF position('v_actual_parent IS DISTINCT FROM p_original_event_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'self-test failed: notify_waitlist_duplicate_plan missing lineage-link validation';
  END IF;
END
$do$;
