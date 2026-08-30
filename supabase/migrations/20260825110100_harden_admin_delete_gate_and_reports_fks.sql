-- Local inventory note: this file was originally committed and directly
-- applied as 20260825110000_harden_admin_delete_gate_and_reports_fks.sql.
-- It was renamed to version 20260825110100 on 2026-08-29 because a parallel
-- migration already owned 20260825110000. The SQL is unchanged; the rename
-- only restores deterministic ordering for fresh databases. See
-- docs/database/migration-provenance.json.
--
-- Two narrow, independent hardening fixes found during the 2026-08-25
-- admin/ban correctness read:
--
-- 1. admin_cascade_delete_user(p_user_id) has no internal permission check
--    of its own -- it's safe today only because EXECUTE is granted solely to
--    postgres/service_role (confirmed live: authenticated/anon both return
--    false). One careless future GRANT would turn it into a full
--    account-wipe with no gate at all. Fix mirrors admin_ban_user()'s own
--    gate verbatim -- same admin_users check, same error, same ERRCODE.
--    No caller of this function was found anywhere in WashedUp,
--    washedup-web, washedup-world, or command-center-next; it's presumably
--    invoked directly (Studio SQL editor or an external tool outside these
--    repos). This gate is the same mechanism admin_ban_user already uses
--    in what's understood to be its live, working path -- but that has not
--    been directly confirmed against THIS function's real caller, since no
--    caller could be found to test against. Worth a smoke test against
--    whatever really calls this before leaning on it.
--
-- 2. reports has zero FK constraints on any of its 5 nullable/creator
--    reference columns. Adding all of them isn't safe today -- see the
--    "Deliberately NOT touched" note below. Only the two columns with zero
--    real-data risk are added here.
--
-- Deliberately NOT touched, and why:
--   - reports.reported_user_id -> profiles(id): 14 of 49 live rows are
--     already orphaned (confirmed by direct count 2026-08-25). Root cause:
--     admin_ban_user() deletes the reported user's profile but never
--     touches `reports`, so any report naming them as reported_user_id is
--     left dangling. A FK here needs that data cleaned up (or the orphaned
--     rows nulled/backfilled) first -- a data decision, not this
--     migration's call.
--   - reports.reported_event_id -> events(id): 5 of 19 populated rows are
--     already orphaned, same root cause shape (event deleted out from
--     under a report that named it). Same reasoning, not touched.
--   - reports.reporter_user_id -> profiles(id): 0 orphans exist today, but
--     that's luck, not a guarantee -- admin_ban_user() is the ONLY one of
--     the app's three user-delete paths that doesn't clean up `reports`
--     first. Both admin_cascade_delete_user() and delete_own_account()
--     already run `DELETE FROM reports WHERE reporter_user_id = ... OR
--     reported_user_id = ...` before deleting the profile; admin_ban_user()
--     has no equivalent line. Adding an enforcing FK on reporter_user_id
--     before that gap is closed would make the *next* admin-ban of anyone
--     who has ever filed a report throw an unhandled FK violation and fail
--     the ban outright. Fixing admin_ban_user() itself is outside this
--     migration's scope (found via investigating reports, not part of the
--     original ask) -- flagging it here so it doesn't get lost, not fixing
--     it silently alongside an unrelated function.
--   - get_event_members_reveal(): investigated as a possible drop target
--     (flagged elsewhere as a landmine nothing calls since the 8/24
--     who's-going fix). Confirmed FALSE -- it is still the primary,
--     actively-called path in both app/plan/[id].tsx (native) and
--     src/app/app/plan/[id]/page.tsx (web); get_event_members_public() is
--     only the fallback for non-members. Not touched, not dropped.

BEGIN;

-- Fix 1: internal permission gate, mirrors admin_ban_user() exactly.
CREATE OR REPLACE FUNCTION public.admin_cascade_delete_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  caller_id uuid;
BEGIN
  caller_id := auth.uid();

  IF caller_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = caller_id
  ) THEN
    RAISE EXCEPTION 'forbidden: admin only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Same order and predicates as the pre-2026-05-20 inline edge fn so
  -- behavior is preserved exactly. Wrapped in this function = wrapped in
  -- a single implicit transaction = atomic.
  DELETE FROM messages WHERE user_id = p_user_id;
  DELETE FROM event_members WHERE user_id = p_user_id;
  DELETE FROM chat_reads WHERE user_id = p_user_id;
  DELETE FROM friends WHERE user_id = p_user_id OR friend_id = p_user_id;
  DELETE FROM reports WHERE reporter_user_id = p_user_id OR reported_user_id = p_user_id;
  DELETE FROM events WHERE creator_user_id = p_user_id;
  DELETE FROM profiles WHERE id = p_user_id;
END;
$function$;

-- Fix 2: FK constraints for the two reports columns with zero live orphans
-- AND zero rows currently populating them (0/0 -- confirmed live), so
-- NOT VALID is a formality here rather than a hedge: validating immediately
-- below carries no risk of failure.
ALTER TABLE public.reports
  ADD CONSTRAINT reports_reported_message_id_fkey
  FOREIGN KEY (reported_message_id) REFERENCES public.messages(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reviewed_by_admin_id_fkey
  FOREIGN KEY (reviewed_by_admin_id) REFERENCES public.profiles(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.reports VALIDATE CONSTRAINT reports_reported_message_id_fkey;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_reviewed_by_admin_id_fkey;

DO $$
BEGIN
  IF position('SELECT 1 FROM admin_users WHERE user_id = caller_id' IN pg_get_functiondef('public.admin_cascade_delete_user(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'admin_cascade_delete_user is missing the admin_users gate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.reports'::regclass AND conname='reports_reported_message_id_fkey' AND convalidated) THEN
    RAISE EXCEPTION 'reports_reported_message_id_fkey missing or not validated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.reports'::regclass AND conname='reports_reviewed_by_admin_id_fkey' AND convalidated) THEN
    RAISE EXCEPTION 'reports_reviewed_by_admin_id_fkey missing or not validated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.reports'::regclass AND conname='reports_reported_user_id_fkey') THEN
    RAISE EXCEPTION 'reports_reported_user_id_fkey should not exist -- 14 known orphans, this migration must not add it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.reports'::regclass AND conname='reports_reported_event_id_fkey') THEN
    RAISE EXCEPTION 'reports_reported_event_id_fkey should not exist -- 5 known orphans, this migration must not add it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.reports'::regclass AND conname='reports_reporter_user_id_fkey') THEN
    RAISE EXCEPTION 'reports_reporter_user_id_fkey should not exist -- admin_ban_user() does not clean up reports first, this migration must not add it';
  END IF;
  IF to_regprocedure('public.get_event_members_reveal(uuid)') IS NULL THEN
    RAISE EXCEPTION 'get_event_members_reveal was dropped -- it is still a live caller path in both apps, must not be dropped';
  END IF;
END $$;

COMMIT;
