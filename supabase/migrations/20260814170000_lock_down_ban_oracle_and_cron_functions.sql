-- DRAFTED 2026-08-14, NOT YET APPLIED. Third file in the same-night grant
-- hardening sequence: 20260814152000 (get_suspicious_accounts_v2),
-- 20260814160000 (command center + oracle RPCs), this one. Same bug class as
-- both: Supabase auto-grants EXECUTE to anon/authenticated on new public
-- functions unless a migration explicitly revokes it, so 14 SECURITY DEFINER
-- functions that were only ever meant to be called by pg_cron (or by nobody)
-- have been callable by any anonymous visitor holding the public anon key.
--
-- Every grant claim below was verified live against production on 2026-08-14
-- via read-only queries (pg_proc.proacl via aclexplode, plus
-- has_function_privilege for PUBLIC inheritance), independently confirmed
-- twice by two separate passes.
--
-- APPLY PATH, READ BEFORE RUNNING: do not apply this via `supabase db push`.
-- The local migration ledger (supabase_migrations.schema_migrations, 417
-- rows, newest 20260814140100) does not record 150000, 151000, 152000, or
-- 160000, even though 151000/152000/160000 are already live in production
-- (applied directly, same as the other two). A push would try to replay
-- 150000 first, which its own header says not to apply before
-- command-center-next is confirmed dead (unresolved as of tonight), then hit
-- 151000's ADD CONSTRAINT with no IF NOT EXISTS and fail because that
-- constraint already exists live. Apply this file the same way 152000 and
-- 160000 were actually applied tonight (direct SQL execution, not the CLI
-- push path), and separately: task #42 (migration history repair) needs to
-- happen before ANY of these five files can go through the normal path.
--
-- This file intentionally uses bare REVOKE/GRANT statements with no
-- transaction wrapper and no inline self-test DO block, matching the exact
-- shape of 152000 and 160000, the two files in this sequence with a proven
-- track record on this project's actual apply channel. An earlier draft used
-- a BEGIN/DO-block/self-test shape copied from 150000, but 150000 has never
-- actually been applied, so that shape is unproven here. Verify after
-- applying with the read-only query at the bottom of this file instead of an
-- inline self-test.
--
--
-- 1. is_identifier_banned(check_email text, check_phone text)  [HIGH]
--
-- A ban-evasion oracle. SECURITY DEFINER, no internal auth check, and live
-- right now with PUBLIC + anon + authenticated EXECUTE. A banned user can
-- call it straight from the browser with the public anon key and test which
-- of their email addresses and phone numbers are burned before spending an
-- SMS on a re-registration attempt, and can enumerate whether any arbitrary
-- third party is banned. Zero real callers: grepped all 4 repos (WashedUp,
-- washedup-web, washedup-world, command-center-next) and the only hit is a
-- documentation table row in WashedUp/docs/SCHEMA.md:243. No pg_cron job
-- references it, no RLS policy references it, and no other function body
-- references it. Restricted to service_role.
--
--
-- 2. Thirteen cron-only maintenance functions  [MEDIUM]
--
-- All SECURITY DEFINER, all owned by postgres, all currently anon-callable
-- (some through explicit anon/authenticated grants, run_signup_watchdog only
-- through PUBLIC, which is why a plain "REVOKE FROM anon, authenticated"
-- would not have been enough on its own, this file revokes PUBLIC too).
-- These write data: they blast app_notifications rows, flip event and album
-- status, expire interest signals, delete notification history, and cascade
-- the waitlist state machine. Damage is capped because each is time-gated
-- and deduped, so an attacker mostly gets to run tomorrow's batch early
-- rather than fabricate arbitrary state, but none of it should be reachable
-- from an anonymous browser session.
--
-- Nothing scheduled breaks. All 9 of these that pg_cron actually calls
-- (expire-stale-interests, albums-flush-heart-batches,
-- albums-flush-upload-notifications, albums-creator-no-uploads-nudge,
-- waitlist-exceptions-expire, purge-old-notifications,
-- signup-anomaly-watchdog, albums-send-upload-prompts,
-- albums-send-upload-reminders) run with cron.job.username = 'postgres',
-- verified live, and postgres owns every one of these functions. Cron
-- survives on the owner's own execute right, which no REVOKE against
-- PUBLIC/anon/authenticated can touch, not because service_role holds the
-- grant (service_role is granted here too, for any server-side caller, but
-- it is not what keeps cron working).
--
-- Three of the thirteen have no caller at all, not even cron:
--   auto_complete_past_events  the "auto-complete-past-plans" job (jobid 7)
--                              runs its own inline UPDATE against events, it
--                              does not call this function. Dead entry point.
--   create_event_reminders     no cron job, no app caller, no policy.
--   flip_albums_to_ready       no cron job, no app caller, no policy.
-- They are restricted rather than dropped: dropping is a separate decision
-- and this file only moves grants.
--
-- process_expired_waitlist has exactly one caller anywhere, and it is not an
-- app or a cron job: expire_stale_notifications() does PERFORM
-- process_expired_waitlist(). expire_stale_notifications is SECURITY DEFINER
-- and owned by postgres, so that nested call executes as postgres regardless
-- of who invoked the outer function, and revoking the caller-facing grants
-- here does not break it. Confirmed live by scanning every pg_proc.prosrc in
-- the public schema for references to all 14 names, and separately
-- re-confirmed against pg_trigger, view/matview definitions, pg_attrdef
-- column defaults, pg_constraint, index expressions, and every
-- non-public-schema function body: zero additional references anywhere.
--
--
-- 3. check_banned_apple_sub(p_apple_sub text)  [narrowed, not locked]
--
-- Same oracle shape as is_identifier_banned, but unlike it this one has real
-- live callers, three of them: WashedUp/lib/socialAuth.ts:24
-- (isBannedAppleUser, called from app/_layout.tsx:754 and app/_layout.tsx:929)
-- and WashedUp/lib/socialAuth.ts:83, inside signInWithApple itself, called
-- after supabase.auth.signInWithIdToken has already resolved and persisted a
-- session. All three run only once a session exists and always pass the
-- caller's own Apple sub claim out of their own session, never anon. anon
-- and PUBLIC are revoked, authenticated is kept and re-granted explicitly
-- (revoking PUBLIC alone would otherwise have cut authenticated off too,
-- since part of its reach came through PUBLIC). The remaining narrow risk,
-- one signed-in user probing an arbitrary Apple sub, wants an internal auth
-- check inside the function body, which is a code change and deliberately
-- out of scope for a grants-only migration.
--
--
-- 4. Deliberately NOT touched
--
-- expire_stale_notifications(): anon-callable and it cascades into
-- process_expired_waitlist (row deletes plus waitlist promotions), so it
-- looks like it belongs in the list above, but it has three real live
-- callers that run as the end user, not as service_role:
-- WashedUp/components/InboxModal.tsx:116,
-- washedup-web/src/components/app/NotificationsPanel.tsx:124, and
-- WashedUp/supabase/functions/send-push-notifications/index.ts:30. Opening
-- the notification inbox fires it. Revoking authenticated here would break
-- the inbox for every real user, and the correct fix (stop running a
-- waitlist state machine off a UI read, move it to cron) is a design
-- decision, not a grant change. Left exactly as-is on purpose.
--
-- is_admin(uuid) and has_role(uuid, app_role): already audited and left
-- alone in 20260814160000 for the same reason as before, they are
-- referenced from 64 and 88 live RLS policies respectively. Nothing here
-- changes that.
--
-- archive_empty_albums, auto_complete_past_explore_events,
-- run_ticket_inbox_watchdog, release_expired_ticket_holds,
-- capture_weekly_snapshot: checked in the same live pass, already
-- postgres + service_role only. No change needed.
--
--
-- 5. NOT fixed here, separate open question: the root cause is a schema-level
-- default. Live right now, pg_default_acl carries a row for schema public,
-- objtype 'f' (functions), for both the postgres and supabase_admin owners,
-- that auto-grants EXECUTE to PUBLIC/anon/authenticated/service_role on every
-- NEW function created in this schema, which is the actual mechanism behind
-- every anon-grant bug found tonight (this file, 152000, 160000). This
-- migration only fixes the 15 functions named above; it does not touch the
-- default, so any future CREATE FUNCTION (or a DROP + CREATE rewrite, which
-- this repo does, 152000 is one from tonight) reopens the same class of hole
-- with no warning. Closing it means `ALTER DEFAULT PRIVILEGES FOR ROLE
-- postgres, supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM
-- PUBLIC` (plus deciding whether to also strip the default anon/authenticated
-- grant, which would make explicit GRANTs mandatory on every future
-- function). That is a project-wide policy change affecting all future
-- function creation, not a narrow fix, and is deliberately left as an open
-- decision rather than folded into this file.

REVOKE ALL ON FUNCTION public.is_identifier_banned(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_identifier_banned(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_identifier_banned(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.auto_complete_past_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_complete_past_events() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_complete_past_events() TO service_role;

REVOKE ALL ON FUNCTION public.create_event_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_event_reminders() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_reminders() TO service_role;

REVOKE ALL ON FUNCTION public.flip_albums_to_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flip_albums_to_ready() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flip_albums_to_ready() TO service_role;

REVOKE ALL ON FUNCTION public.expire_stale_interests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_interests() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_interests() TO service_role;

REVOKE ALL ON FUNCTION public.flush_album_heart_batches() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flush_album_heart_batches() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flush_album_heart_batches() TO service_role;

REVOKE ALL ON FUNCTION public.flush_album_upload_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flush_album_upload_notifications() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flush_album_upload_notifications() TO service_role;

REVOKE ALL ON FUNCTION public.nudge_creators_no_uploads() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nudge_creators_no_uploads() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nudge_creators_no_uploads() TO service_role;

REVOKE ALL ON FUNCTION public.process_expired_exceptions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_expired_exceptions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_exceptions() TO service_role;

REVOKE ALL ON FUNCTION public.process_expired_waitlist() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_expired_waitlist() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_expired_waitlist() TO service_role;

REVOKE ALL ON FUNCTION public.purge_old_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_old_notifications() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_notifications() TO service_role;

REVOKE ALL ON FUNCTION public.run_signup_watchdog() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_signup_watchdog() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_signup_watchdog() TO service_role;

REVOKE ALL ON FUNCTION public.send_album_upload_prompts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_album_upload_prompts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_album_upload_prompts() TO service_role;

REVOKE ALL ON FUNCTION public.send_album_upload_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_album_upload_reminders() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_album_upload_reminders() TO service_role;

REVOKE ALL ON FUNCTION public.check_banned_apple_sub(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_banned_apple_sub(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_banned_apple_sub(text) TO authenticated, service_role;

-- VERIFY AFTER APPLYING, read-only, run this and expect zero rows:
--
-- SELECT routine_name, grantee FROM information_schema.role_routine_grants
-- WHERE routine_name IN (
--   'is_identifier_banned','auto_complete_past_events','create_event_reminders',
--   'flip_albums_to_ready','expire_stale_interests','flush_album_heart_batches',
--   'flush_album_upload_notifications','nudge_creators_no_uploads',
--   'process_expired_exceptions','process_expired_waitlist',
--   'purge_old_notifications','run_signup_watchdog',
--   'send_album_upload_prompts','send_album_upload_reminders'
-- ) AND grantee IN ('anon','authenticated','PUBLIC');
--
-- Then confirm check_banned_apple_sub separately, expect exactly one row
-- (authenticated):
--
-- SELECT routine_name, grantee FROM information_schema.role_routine_grants
-- WHERE routine_name = 'check_banned_apple_sub' AND grantee IN ('anon','authenticated','PUBLIC');
