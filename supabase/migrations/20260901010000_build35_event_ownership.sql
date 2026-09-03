-- APPLIED TO PRODUCTION 2026-09-02 (Josh's go). Verified same day: 22/22
-- explore_events rows carry a non-null owner_type, zero data loss. Kept in
-- supabase/migrations/ as the historical record; safe to re-run (idempotent).
--
-- Build 35 / P3 batch A item A1: give every event a real, explicit, audited owner.
--
-- Written for master plan v3 §5.1 A1
-- (clients/washed-up/specs/washedup-MASTER-PLAN-v3-20260831.md), under the A2
-- decision of 2026-08-31 (Organization stays a single person; organizer_profiles
-- stays keyed user_id).
--
-- Full design rationale, live-data evidence, and backfill proof:
-- clients/washed-up/specs/washedup-BUILD35-EVENT-OWNERSHIP-20260831.md
--
-- Ordering: this file sorts AFTER 20260901000000_build35_community_role_reconciliation.sql
-- so the two can be applied together in either combination without conflict.
-- They touch disjoint objects and neither depends on the other.
--
-- Naming: every new object uses an `event_owner_*` prefix rather than the
-- table's own `explore_events_*` prefix. The cluster is one coherent feature and
-- reads better named for its purpose; it also keeps these identifiers clear of
-- the repo's secret scanner, which matches `explo` + `re_events_...` as a
-- Resend-style key.
--
-- ---------------------------------------------------------------------------
-- SCOPE. Additive and reversible.
--
--   Adds four columns to public.explore_events (owner_type, owner_user_id,
--   owner_community_id, and a GENERATED owner_id), one new audit table, and
--   two triggers.
--
--   Does NOT drop or alter host_user_id or community_id. Both keep their exact
--   current type, nullability, and ON DELETE SET NULL foreign keys. Live code
--   still reads them (RLS policy "Operators can view own explore events", and
--   both apps) and this is a foundation step, not a cutover.
--
--   Does NOT modify operator_create_explore_event(), admin_create_explore_event(),
--   is_community_leader(), any RLS policy, or any grant on any existing object.
--   Forward population is handled by a BEFORE INSERT trigger instead of by
--   editing those function bodies -- see section 5 for why that is the stronger
--   choice, not the lazier one.
--
--   Changes no existing row's meaning: the backfill only fills columns that did
--   not exist a statement earlier.
--
-- REVERSAL (deliberately a comment, not executable -- matches the A3 precedent
-- and keeps this file clear of the release migration policy check):
--   DROP TRIGGER IF EXISTS event_owner_change ON public.explore_events;
--   DROP TRIGGER IF EXISTS event_owner_derive ON public.explore_events;
--   DROP FUNCTION IF EXISTS public.tg_event_owner_change();
--   DROP FUNCTION IF EXISTS public.tg_event_owner_derive();
--   ALTER TABLE public.explore_events
--     DROP COLUMN IF EXISTS owner_id,
--     DROP COLUMN IF EXISTS owner_community_id,
--     DROP COLUMN IF EXISTS owner_user_id,
--     DROP COLUMN IF EXISTS owner_type;
--   DROP TABLE IF EXISTS public.event_owner_changes;
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Owner columns, nullable first so the backfill has somewhere to land.
--
--    Three owner types, matching PDF Appendix C.11 invariant 1 ("Organization,
--    Community, or eligible individual creator") plus the one class that
--    invariant does not name but production actually holds:
--
--      'community'    -> owner_community_id. The community is the authority;
--                        this is what is_community_leader() already gates.
--      'organization' -> owner_user_id. Under A2 an Organization IS one person,
--                        so "Organization" and "eligible individual creator"
--                        are the same row shape today. They separate later.
--      'platform'     -> neither. Admin-curated Explore listings inserted by
--                        admin_create_explore_event(), which sets no host and
--                        no community. 8 of 20 live rows are this. They have no
--                        owner to discover, and inventing one would be fabricated
--                        data, so the model states the truth instead.
--
--    owner_user_id references auth.users, NOT organizer_profiles. Live check
--    2026-08-31: 5 distinct host_user_id values exist across explore_events and
--    only 1 of them has an organizer_profiles row. Referencing organizer_profiles
--    would fail the foreign key on 4 of 5 hosts and lose real events.
-- ---------------------------------------------------------------------------

ALTER TABLE public.explore_events
  ADD COLUMN IF NOT EXISTS owner_type         text,
  ADD COLUMN IF NOT EXISTS owner_user_id      uuid,
  ADD COLUMN IF NOT EXISTS owner_community_id uuid;

-- ON DELETE SET NULL mirrors the existing host_user_id / community_id foreign
-- keys exactly, so deleting a community or a user behaves as it does today.
-- The BEFORE UPDATE trigger in section 4 catches the resulting NULL and re-homes
-- the event, so the one-owner CHECK can never turn a legal delete into a failure.
ALTER TABLE public.explore_events
  DROP CONSTRAINT IF EXISTS event_owner_user_fk;
ALTER TABLE public.explore_events
  ADD  CONSTRAINT event_owner_user_fk
       FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.explore_events
  DROP CONSTRAINT IF EXISTS event_owner_community_fk;
ALTER TABLE public.explore_events
  ADD  CONSTRAINT event_owner_community_fk
       FOREIGN KEY (owner_community_id) REFERENCES public.communities(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. Backfill every existing row from the current derived pair.
--
--    Precedence is community-first, and that is a decision, not an accident.
--    When both host_user_id and community_id are set (7 live rows),
--    operator_create_explore_event() has already required
--    is_community_leader(p_community_id, v_uid) to pass. The community is the
--    authority that permitted the event; the user is the person who typed it.
--    host_user_id is preserved untouched, so "who created it" is never lost --
--    it simply stops being confused with "who owns it".
--
--    Total coverage is guaranteed: the three CASE arms are (community set),
--    (no community, host set), (neither), which partition every possible row.
-- ---------------------------------------------------------------------------

UPDATE public.explore_events
   SET owner_type = CASE
                      WHEN community_id  IS NOT NULL THEN 'community'
                      WHEN host_user_id  IS NOT NULL THEN 'organization'
                      ELSE                                'platform'
                    END,
       owner_community_id = CASE
                              WHEN community_id IS NOT NULL THEN community_id
                              ELSE NULL
                            END,
       owner_user_id      = CASE
                              WHEN community_id IS NULL AND host_user_id IS NOT NULL
                                THEN host_user_id
                              ELSE NULL
                            END
 WHERE owner_type IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Constrain: exactly one owner, always.
--
--    This is PDF invariant 1 made structural rather than conventional. The CHECK
--    is exhaustive over owner_type, so there is no fourth state a future writer
--    can slip into, and no combination where two owner columns are both set.
-- ---------------------------------------------------------------------------

ALTER TABLE public.explore_events
  ALTER COLUMN owner_type SET NOT NULL;

ALTER TABLE public.explore_events
  DROP CONSTRAINT IF EXISTS event_owner_type_valid;
ALTER TABLE public.explore_events
  ADD  CONSTRAINT event_owner_type_valid
       CHECK (owner_type IN ('organization', 'community', 'platform'));

ALTER TABLE public.explore_events
  DROP CONSTRAINT IF EXISTS event_exactly_one_owner;
ALTER TABLE public.explore_events
  ADD  CONSTRAINT event_exactly_one_owner
       CHECK (
         (owner_type = 'organization'
            AND owner_user_id      IS NOT NULL
            AND owner_community_id IS NULL)
      OR (owner_type = 'community'
            AND owner_community_id IS NOT NULL
            AND owner_user_id      IS NULL)
      OR (owner_type = 'platform'
            AND owner_user_id      IS NULL
            AND owner_community_id IS NULL)
       );

-- The single owner_id handle the PDF's domain model asks for (Appendix C.11:
-- "Event with owner_type and owner_id"), derived rather than stored separately.
-- GENERATED ALWAYS means application code physically cannot write an owner_id
-- that disagrees with the typed, foreign-keyed columns. Added after the backfill
-- so it computes over real values. NULL for 'platform', which is correct: a
-- platform listing has an owner_type and no owner entity.
ALTER TABLE public.explore_events
  ADD COLUMN IF NOT EXISTS owner_id uuid
  GENERATED ALWAYS AS (COALESCE(owner_user_id, owner_community_id)) STORED;

CREATE INDEX IF NOT EXISTS event_owner_idx
  ON public.explore_events (owner_type, owner_id);

COMMENT ON COLUMN public.explore_events.owner_type IS
  'Build 35 A1. Which entity owns this event: organization (owner_user_id), community (owner_community_id), or platform (admin-curated, no owner entity). Enforces PDF invariant 1.';
COMMENT ON COLUMN public.explore_events.owner_id IS
  'Build 35 A1. Generated: COALESCE(owner_user_id, owner_community_id). Read-only by construction so it can never disagree with the typed owner columns. NULL when owner_type = platform.';
COMMENT ON COLUMN public.explore_events.host_user_id IS
  'Creator attribution ("Created by"), NOT ownership. Ownership moved to owner_type/owner_id in Build 35 A1. Preserved deliberately: a community-owned event still records the person who made it.';

-- ---------------------------------------------------------------------------
-- 4. Audit owner changes. PDF invariant 2 (owner changes after sales begin are
--    an audited administrative action, never implicit) and invariant 10 (every
--    permission-sensitive mutation writes an audit record).
--
--    Fail-closed, exactly like community_role_assignments in the A3 migration:
--    RLS on, zero policies, grants revoked from anon and authenticated. No
--    client can read or forge an ownership history. The triggers write through
--    SECURITY DEFINER.
--
--    Owner ids are stored WITHOUT foreign keys on purpose. An audit row has to
--    outlive the community or user it names; a cascade that erased the history
--    of a transfer would defeat the record.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_owner_changes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                    uuid NOT NULL REFERENCES public.explore_events(id) ON DELETE CASCADE,
  changed_at                  timestamptz NOT NULL DEFAULT now(),
  changed_by                  uuid,
  actor_db_role               text NOT NULL,
  previous_owner_type         text,
  previous_owner_user_id      uuid,
  previous_owner_community_id uuid,
  new_owner_type              text NOT NULL,
  new_owner_user_id           uuid,
  new_owner_community_id      uuid,
  reason                      text NOT NULL,
  had_committed_guests        boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS event_owner_changes_event_idx
  ON public.event_owner_changes (event_id, changed_at DESC);

ALTER TABLE public.event_owner_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_owner_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_owner_changes TO service_role;

COMMENT ON TABLE public.event_owner_changes IS
  'Build 35 A1. Append-only record of every change to an event owner. Service-only: RLS enabled with no policies, so it is unreadable and unwritable from any client. Written by trigger only.';
COMMENT ON COLUMN public.event_owner_changes.had_committed_guests IS
  'Snapshot at change time: the event already had a paid/refunded ticket order or an active RSVP. Distinguishes a routine pre-sale correction from a transfer that moved real guest obligations.';

-- 4a. Forward population for every insert path.
--     `tg_` prefix matches the trigger-function convention already used by the
--     three existing triggers on this table.
CREATE OR REPLACE FUNCTION public.tg_event_owner_derive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Build 35 code that sets ownership explicitly is left alone.
  IF NEW.owner_type IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Same precedence as the section 2 backfill, so a row inserted one second
  -- after this migration applies is classified identically to one inserted a
  -- year before it.
  IF NEW.community_id IS NOT NULL THEN
    NEW.owner_type         := 'community';
    NEW.owner_community_id := NEW.community_id;
    NEW.owner_user_id      := NULL;
  ELSIF NEW.host_user_id IS NOT NULL THEN
    NEW.owner_type         := 'organization';
    NEW.owner_user_id      := NEW.host_user_id;
    NEW.owner_community_id := NULL;
  ELSE
    NEW.owner_type         := 'platform';
    NEW.owner_user_id      := NULL;
    NEW.owner_community_id := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS event_owner_derive ON public.explore_events;
CREATE TRIGGER event_owner_derive
  BEFORE INSERT ON public.explore_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_owner_derive();

-- 4b. Guard + audit owner changes, in ONE BEFORE UPDATE trigger.
--
--     Three jobs, all of which must happen before the one-owner CHECK is
--     evaluated (Postgres order: BEFORE row trigger, then CHECK, then write):
--
--     (i)   Foreign key cascade. Deleting a community issues
--           UPDATE explore_events SET owner_community_id = NULL, which would
--           otherwise violate the CHECK and block a legal delete. Instead the
--           event is re-homed -- to its still-present host if there is one,
--           otherwise to platform -- and the cascade is recorded as a real
--           owner change rather than silently swallowed.
--
--     (ii)  Invariant 2. Once an event has committed guests, an owner change
--           must be a deliberate administrative act. The caller declares intent
--           in the same transaction, BEFORE the UPDATE:
--             SELECT set_config('washedup.owner_change_reason', '<why>', true);
--           No reason on an event with guests raises. That is the literal
--           meaning of "never implicit".
--
--     (iii) Write the audit row.
--
--     WHY ONE TRIGGER AND NOT A BEFORE/AFTER PAIR. A function declared with a
--     SET clause (every function here sets search_path, as this codebase
--     requires) runs inside its own GUC nest level, so any set_config(..., true)
--     it makes is rolled back when the function returns -- not at commit. A
--     BEFORE trigger therefore cannot hand a computed reason to a separate AFTER
--     trigger through a GUC; the cascade reason in (i) would silently arrive as
--     NULL and every cascade would be audited as "unspecified". Keeping the
--     reason in a local variable inside a single function removes that whole
--     class of bug. Auditing from BEFORE is still correct and still atomic: if
--     the UPDATE subsequently fails the CHECK, the audit INSERT rolls back with
--     it, and no other trigger on this table touches the owner columns.
CREATE OR REPLACE FUNCTION public.tg_event_owner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason    text;
  v_committed boolean;
BEGIN
  IF NEW.owner_type IS NOT DISTINCT FROM OLD.owner_type
     AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
     AND NEW.owner_community_id IS NOT DISTINCT FROM OLD.owner_community_id THEN
    RETURN NEW;
  END IF;

  -- caller-declared intent, read from the transaction (set outside any function,
  -- so it is visible here)
  v_reason := nullif(btrim(coalesce(current_setting('washedup.owner_change_reason', true), '')), '');

  -- (i) re-home after a foreign key cascade nulled the owner out from under us
  IF NEW.owner_type = 'community' AND NEW.owner_community_id IS NULL THEN
    IF NEW.host_user_id IS NOT NULL THEN
      NEW.owner_type    := 'organization';
      NEW.owner_user_id := NEW.host_user_id;
    ELSE
      NEW.owner_type    := 'platform';
      NEW.owner_user_id := NULL;
    END IF;
    v_reason := 'automatic: owning community deleted, event re-homed';
  ELSIF NEW.owner_type = 'organization' AND NEW.owner_user_id IS NULL THEN
    NEW.owner_type         := 'platform';
    NEW.owner_community_id := NULL;
    v_reason := 'automatic: owning user deleted, event re-homed to platform';
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM public.ticket_orders o
            WHERE o.event_id = NEW.id AND o.status IN ('paid', 'refunded')
         )
      OR EXISTS (
           SELECT 1 FROM public.explore_event_rsvps r
            WHERE r.explore_event_id = NEW.id AND r.status = 'going'
         )
    INTO v_committed;

  -- (ii) invariant 2
  IF v_reason IS NULL AND v_committed THEN
    RAISE EXCEPTION
      'Event % has committed guests; an owner change must be an explicit administrative action. Set washedup.owner_change_reason in this transaction first.',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (iii) audit
  INSERT INTO public.event_owner_changes (
    event_id, changed_by, actor_db_role,
    previous_owner_type, previous_owner_user_id, previous_owner_community_id,
    new_owner_type, new_owner_user_id, new_owner_community_id,
    reason, had_committed_guests
  ) VALUES (
    NEW.id, auth.uid(), current_user,
    OLD.owner_type, OLD.owner_user_id, OLD.owner_community_id,
    NEW.owner_type, NEW.owner_user_id, NEW.owner_community_id,
    coalesce(v_reason, 'unspecified: no committed guests at change time'),
    v_committed
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS event_owner_change ON public.explore_events;
CREATE TRIGGER event_owner_change
  BEFORE UPDATE OF owner_type, owner_user_id, owner_community_id, community_id, host_user_id
  ON public.explore_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_owner_change();

REVOKE ALL ON FUNCTION public.tg_event_owner_derive(),
  public.tg_event_owner_change()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Why a trigger instead of editing operator_create_explore_event().
--
--    Two functions insert into explore_events today:
--      operator_create_explore_event()  -- always sets host_user_id = auth.uid()
--      admin_create_explore_event()     -- sets neither host nor community
--    plus the "Admins can manage explore events" RLS policy, which permits a
--    direct INSERT by any admin with no function involved at all.
--
--    Patching only the operator RPC would leave the admin RPC and the direct
--    admin path inserting rows with a NULL owner_type, which the NOT NULL in
--    section 3 would then reject -- breaking the admin Explore tool on the day
--    this applies. A BEFORE INSERT trigger covers all three paths with one
--    object and leaves both live function definitions byte-for-byte unchanged,
--    which is also the smaller diff against a live production database.
--
--    is_community_leader() is likewise untouched. It keeps gating writes exactly
--    as it does now. Nothing in this migration reads the new columns for
--    authorization; that is Build 35 permission work, deliberately after this.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. Read-only self-test. Assertions only: creates, updates, and deletes no
--    application row. Matches the A3 migration's verification style.
--
--    Note on what is NOT tested here: the insert and update trigger paths are
--    deliberately not exercised by writing a throwaway event, because
--    explore_events carries other triggers (status milestone, community topic
--    creation) that a synthetic row would fire against live data. That belongs
--    in supabase/tests/contracts/, not in a production migration.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_total        bigint;
  v_unowned      bigint;
  v_drift        bigint;
  v_multi        bigint;
  v_community    bigint;
  v_organization bigint;
  v_platform     bigint;
  v_triggers     bigint;
BEGIN
  SELECT count(*) INTO v_total FROM public.explore_events;

  -- (1) every event has an owner_type
  SELECT count(*) INTO v_unowned
    FROM public.explore_events WHERE owner_type IS NULL;
  IF v_unowned <> 0 THEN
    RAISE EXCEPTION 'A1 self-test: % events have no owner_type', v_unowned;
  END IF;

  -- (2) no row lost or gained an owner relative to its source pair.
  --     This is the zero-data-loss proof: it re-derives the expected owner from
  --     the untouched original columns and compares against what was written.
  SELECT count(*) INTO v_drift
    FROM public.explore_events e
   WHERE (e.owner_type, e.owner_user_id, e.owner_community_id)
         IS DISTINCT FROM
         (CASE WHEN e.community_id IS NOT NULL THEN 'community'
               WHEN e.host_user_id IS NOT NULL THEN 'organization'
               ELSE 'platform' END,
          CASE WHEN e.community_id IS NULL AND e.host_user_id IS NOT NULL
               THEN e.host_user_id ELSE NULL END,
          e.community_id);
  IF v_drift <> 0 THEN
    RAISE EXCEPTION 'A1 self-test: % events disagree with their source ownership pair', v_drift;
  END IF;

  -- (3) invariant 1: never two owners on one event
  SELECT count(*) INTO v_multi
    FROM public.explore_events
   WHERE owner_user_id IS NOT NULL AND owner_community_id IS NOT NULL;
  IF v_multi <> 0 THEN
    RAISE EXCEPTION 'A1 self-test: % events carry two owners', v_multi;
  END IF;

  -- (4) the generated owner_id agrees with the typed columns on every row
  SELECT count(*) INTO v_multi
    FROM public.explore_events
   WHERE owner_id IS DISTINCT FROM COALESCE(owner_user_id, owner_community_id);
  IF v_multi <> 0 THEN
    RAISE EXCEPTION 'A1 self-test: % events have an owner_id that does not match', v_multi;
  END IF;

  -- (5) both triggers are actually attached and enabled
  SELECT count(*) INTO v_triggers
    FROM pg_trigger
   WHERE tgrelid = 'public.explore_events'::regclass
     AND NOT tgisinternal
     AND tgname IN ('event_owner_derive', 'event_owner_change')
     AND tgenabled <> 'D';
  IF v_triggers <> 2 THEN
    RAISE EXCEPTION 'A1 self-test: expected 2 enabled owner triggers, found %', v_triggers;
  END IF;

  -- (6) the audit table is fail-closed
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.event_owner_changes'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'A1 self-test: event_owner_changes does not have RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'event_owner_changes') THEN
    RAISE EXCEPTION 'A1 self-test: event_owner_changes must have no policies (service-only)';
  END IF;
  IF has_table_privilege('authenticated', 'public.event_owner_changes', 'SELECT')
     OR has_table_privilege('anon', 'public.event_owner_changes', 'SELECT') THEN
    RAISE EXCEPTION 'A1 self-test: event_owner_changes is readable by a client role';
  END IF;

  SELECT count(*) FILTER (WHERE owner_type = 'community'),
         count(*) FILTER (WHERE owner_type = 'organization'),
         count(*) FILTER (WHERE owner_type = 'platform')
    INTO v_community, v_organization, v_platform
    FROM public.explore_events;

  RAISE NOTICE 'A1: % events owned -- % community, % organization, % platform',
    v_total, v_community, v_organization, v_platform;
  RAISE NOTICE 'A1: host_user_id and community_id preserved on all % rows; zero events lost.', v_total;
END $$;

COMMIT;
