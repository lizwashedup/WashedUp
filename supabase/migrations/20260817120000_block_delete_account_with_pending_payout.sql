-- REVIEW ONLY. Do not apply without the normal live migration approval.
--
-- Decided policy (2026-08-17, technical lead's call per CODEX_HANDOFF.md
-- item 6 / product doc Part 10): block account deletion while the user is
-- still owed any pending/unpaid organizer payout. No forfeiture, no
-- soft-delete-then-pay. Just a block, with a clear error the app can show.
--
-- CORRECTED same day, before this was ever committed or applied: the first
-- version of this migration checked organizer_receivables. That was wrong.
-- Two independent comments in this codebase (supabase/functions/
-- ticket-refund/index.ts and supabase/functions/ticket-payout-release/
-- index.ts) both describe organizer_receivables as a debt the ORGANIZER
-- owes THE PLATFORM (a processing-fee shortfall that "lands on the
-- organizer" and gets "consumed"/"settled" by deducting from a future
-- payout), not money owed TO the organizer. Checking it would have both
-- under-protected the real target case (an organizer with a genuine unpaid
-- payout and zero receivables debt could still delete freely) and, since
-- ticket_payouts has no FK to auth.users, silently orphaned that unpaid
-- payout row with nobody able to ever pay it -- worse than either
-- alternative this policy explicitly rejected.
--
-- This version checks public.ticket_payouts instead: the table
-- ticket-payout-release/index.ts and claim_ticket_payout_batch_atomic
-- actually write real payouts to (status 'pending' | 'released' | 'failed';
-- 'released' is the only state meaning Stripe successfully paid it out).
-- That is the real "payout owed to the organizer, unpaid" ledger.
--
-- SCHEMA ASSUMPTION, read before touching this file again: ticket_payouts
-- also has no local CREATE TABLE anywhere in this repo's migration history
-- (same drift pattern as organizer_receivables), but its shape is
-- corroborated from source, not guessed: supabase/tests/contracts/
-- 40_payout_claim_fixture.sql's column list matches the real INSERT/UPDATE
-- statements in 20260816120000_claim_ticket_payout_batch_atomic.sql and
-- supabase/functions/ticket-payout-release/index.ts. The DO block below
-- still checks organizer_user_id, status, and amount_cents exist before
-- creating anything that depends on them, and ABORTS THE WHOLE MIGRATION
-- (leaving the live DB unchanged) if any is missing, rather than silently
-- checking the wrong thing on a money table a second time.
--
-- ENFORCEMENT POINT: a BEFORE DELETE trigger on auth.users, not just a
-- check inside delete_own_account(). Every real deletion path in this
-- codebase (delete_own_account()'s own final `DELETE FROM auth.users`, the
-- delete-user and delete-ghost-account edge functions' `auth.admin.
-- deleteUser()` calls, and every sibling-repo admin route that calls
-- `auth.admin.deleteUser()` directly against this same live project) ends
-- in one real SQL DELETE against auth.users. A check placed only inside
-- delete_own_account() would leave all the others open. The trigger is the
-- one point every path funnels through, in this repo and beyond it.
--
-- delete_own_account() also gets its own explicit early check (same
-- predicate function, called directly) so the common self-serve path fails
-- fast, before ~15 cascading DELETEs, using the exact guard-at-the-top style
-- this function already uses for its "Not authenticated" check.
--
-- KNOWN GAP, out of scope for this migration, flagged not fixed:
-- admin-manage-user's delete_and_ban action (supabase/functions/
-- admin-manage-user/index.ts) purges the same user data directly and BANS
-- the auth.users row instead of deleting it, so this trigger never fires
-- for it. Pre-existing, admin-gated, staff-only tool; needs its own,
-- separate look if it should carry the same check.

BEGIN;

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(expected.col ORDER BY expected.col)
  INTO v_missing
  FROM (VALUES ('organizer_user_id'), ('status'), ('amount_cents'))
    AS expected(col)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ticket_payouts'
      AND column_name = expected.col
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ticket_payouts is missing assumed column(s) %. This migration assumes organizer_user_id uuid, status text (pending/released/failed), amount_cents integer -- see this file''s header for the reasoning. Confirm the real columns (information_schema.columns or \d ticket_payouts against the live database) and update public.organizer_has_pending_payout() below to match before re-applying.', v_missing;
  END IF;
END $$;

-- Single source of truth for "is this organizer still owed money". Called
-- from the trigger below, from delete_own_account(), and directly via RPC
-- from the delete-user edge function, so all three enforce the identical
-- definition of "pending". Blocks on anything that is not explicitly
-- 'released' (so 'pending', 'failed', or any future status this migration
-- doesn't know about yet) rather than allow-listing 'pending' alone, so an
-- unrecognized status fails closed instead of silently unblocking a real
-- deletion.
CREATE OR REPLACE FUNCTION public.organizer_has_pending_payout(p_organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ticket_payouts
    WHERE organizer_user_id = p_organizer_user_id
      AND status <> 'released'
      AND amount_cents > 0
  );
$$;

REVOKE ALL ON FUNCTION public.organizer_has_pending_payout(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organizer_has_pending_payout(uuid)
  TO service_role;

-- Universal backstop: fires on the real Postgres DELETE regardless of which
-- code path issued it (an RPC's own DELETE FROM auth.users, or GoTrue's
-- auth.admin.deleteUser() called from any edge function or admin route on
-- this same live project, in this repo or a sibling one).
CREATE OR REPLACE FUNCTION public.block_account_deletion_with_pending_payout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF public.organizer_has_pending_payout(OLD.id) THEN
    RAISE EXCEPTION 'Your account has a pending payout that hasn''t been paid out yet. It must be paid before your account can be deleted. Contact hello@washedup.app if you have questions.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS block_account_deletion_with_pending_payout ON auth.users;
CREATE TRIGGER block_account_deletion_with_pending_payout
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.block_account_deletion_with_pending_payout();

-- Self-test: prove the trigger actually exists on auth.users and is wired to
-- this exact function, the same catalog-introspection convention
-- 20260815120000 uses for its own foreign keys.
DO $$
DECLARE
  v_found boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger trg
    JOIN pg_class rel ON rel.oid = trg.tgrelid
    JOIN pg_namespace rel_ns ON rel_ns.oid = rel.relnamespace
    JOIN pg_proc fn ON fn.oid = trg.tgfoid
    JOIN pg_namespace fn_ns ON fn_ns.oid = fn.pronamespace
    WHERE trg.tgname = 'block_account_deletion_with_pending_payout'
      AND NOT trg.tgisinternal
      AND rel_ns.nspname = 'auth'
      AND rel.relname = 'users'
      AND fn_ns.nspname = 'public'
      AND fn.proname = 'block_account_deletion_with_pending_payout'
  ) INTO v_found;

  IF NOT v_found THEN
    RAISE EXCEPTION 'self-test failed: BEFORE DELETE trigger block_account_deletion_with_pending_payout on auth.users calling public.block_account_deletion_with_pending_payout() was not found as expected';
  END IF;

  RAISE NOTICE 'ok: auth.users BEFORE DELETE -> public.block_account_deletion_with_pending_payout()';
END $$;

-- delete_own_account(): identical body to 20250230100000_delete_own_account_full.sql
-- (its live definition), with one guard added right after the existing
-- "Not authenticated" check, matching that function's own established
-- fail-fast-at-the-top style. Grants are untouched deliberately: this
-- function has never carried an explicit REVOKE/GRANT footer in any of its
-- 4 prior migrations and must stay callable by `authenticated` (the app
-- calls it directly via supabase.rpc('delete_own_account')); CREATE OR
-- REPLACE preserves the existing live ACL as long as the signature is
-- unchanged, so nothing here should be added to change that.
CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_event_ids UUID[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF public.organizer_has_pending_payout(v_user_id) THEN
    RAISE EXCEPTION 'Your account has a pending payout that hasn''t been paid out yet. It must be paid before your account can be deleted. Contact hello@washedup.app if you have questions.';
  END IF;

  -- Collect events created by this user
  SELECT ARRAY_AGG(id) INTO v_event_ids
  FROM events WHERE creator_user_id = v_user_id;

  -- Clean up events the user created
  IF v_event_ids IS NOT NULL AND array_length(v_event_ids, 1) > 0 THEN
    DELETE FROM message_likes WHERE message_id IN (SELECT id FROM messages WHERE event_id = ANY(v_event_ids));
    DELETE FROM messages WHERE event_id = ANY(v_event_ids);
    DELETE FROM event_members WHERE event_id = ANY(v_event_ids);
    DELETE FROM chat_reads WHERE event_id = ANY(v_event_ids);
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'event_feedback') THEN
      DELETE FROM event_feedback WHERE event_id = ANY(v_event_ids);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'email_notification_log') THEN
      DELETE FROM email_notification_log WHERE event_id = ANY(v_event_ids);
    END IF;
    DELETE FROM wishlists WHERE event_id = ANY(v_event_ids);
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'short_codes') THEN
      DELETE FROM short_codes WHERE event_id = ANY(v_event_ids);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'event_waitlist') THEN
      DELETE FROM event_waitlist WHERE event_id = ANY(v_event_ids);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'waitlist_notification_queue') THEN
      DELETE FROM waitlist_notification_queue WHERE event_id = ANY(v_event_ids);
    END IF;
    DELETE FROM events WHERE creator_user_id = v_user_id;
  END IF;

  -- Clean up user's own participation/data
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'message_likes') THEN
    DELETE FROM message_likes WHERE user_id = v_user_id;
  END IF;
  DELETE FROM messages WHERE user_id = v_user_id;
  DELETE FROM event_members WHERE user_id = v_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chat_reads') THEN
    DELETE FROM chat_reads WHERE user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'event_feedback') THEN
    DELETE FROM event_feedback WHERE user_id = v_user_id;
  END IF;
  DELETE FROM wishlists WHERE user_id = v_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'explore_wishlists') THEN
    DELETE FROM explore_wishlists WHERE user_id = v_user_id;
  END IF;
  DELETE FROM friends WHERE user_id = v_user_id OR friend_id = v_user_id;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reports') THEN
    DELETE FROM reports WHERE reporter_user_id = v_user_id OR reported_user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'founder_messages') THEN
    DELETE FROM founder_messages WHERE recipient_user_id = v_user_id OR sender_admin_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'announcements') THEN
    DELETE FROM announcements WHERE sent_by = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'broadcast_message_reads') THEN
    DELETE FROM broadcast_message_reads WHERE user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'email_verification_codes') THEN
    DELETE FROM email_verification_codes WHERE user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sms_verification_codes') THEN
    DELETE FROM sms_verification_codes WHERE user_id = v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_roles') THEN
    DELETE FROM user_roles WHERE user_id = v_user_id;
  END IF;
  DELETE FROM profiles WHERE id = v_user_id;

  DELETE FROM auth.users WHERE id = v_user_id;
END;
$function$;

COMMIT;
