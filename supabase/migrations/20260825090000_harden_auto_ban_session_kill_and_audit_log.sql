-- Session-kill/audit-trail parity for the automatic report-threshold ban path.
-- auto_ban_reported_user() currently only flips auth.users.banned_until, so a
-- banned user's live session keeps working until it naturally expires, no
-- identifier gets recorded in banned_identifiers, no row lands in
-- moderation_actions, and any failure is swallowed silently with zero trace.
-- This migration fixes exactly those four technical gaps, mirroring the
-- session-kill/identifier-recording logic admin_ban_user() already has.
--
-- Deliberately NOT touched: the report_count >= 3 threshold, the reporter-
-- distinctness question, and whether this path should be automatic at all.
-- Those are product/moderation policy, Liz's call -- see the "Automatic
-- moderation, contingent alternative" section of docs/liz/2026-08-24-
-- approval-pack.md. The migration-time check at the bottom of this file
-- asserts the threshold line is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.moderation_automation_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation text NOT NULL,
  target_user_id uuid,
  error_code text NOT NULL,
  error_message text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.moderation_automation_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_automation_failures FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.moderation_automation_failures TO service_role;

CREATE OR REPLACE FUNCTION public.auto_ban_reported_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  report_count    integer;
  v_rows          integer;
  v_email         text;
  v_phone         text;
  v_apple_sub     text;
  v_profile_email text;
BEGIN
  SELECT COUNT(*) INTO report_count
  FROM reports
  WHERE reported_user_id = NEW.reported_user_id
    AND reason IS DISTINCT FROM 'Blocked by user';

  IF report_count >= 3 THEN
    UPDATE auth.users
    SET banned_until = '2099-01-01 00:00:00+00'
    WHERE id = NEW.reported_user_id
      AND (banned_until IS NULL OR banned_until < NOW());

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- v_rows > 0 only the first time this user crosses the threshold -- every
    -- later report re-fires this trigger and re-evaluates report_count >= 3,
    -- but the WHERE guard above makes the UPDATE a no-op from then on, so
    -- everything below only runs once per user, same as before this change.
    IF v_rows > 0 THEN
      -- banned_until alone only blocks token refresh; it doesn't end a
      -- session that's already live. Mirrors admin_ban_user()'s session-kill.
      DELETE FROM auth.refresh_tokens WHERE user_id = NEW.reported_user_id::text;
      DELETE FROM auth.sessions       WHERE user_id = NEW.reported_user_id;

      SELECT u.email, u.phone::text, u.raw_user_meta_data->>'sub'
        INTO v_email, v_phone, v_apple_sub
      FROM auth.users u WHERE u.id = NEW.reported_user_id;

      -- Phone-auth users have no auth.users.email; mirrors admin_ban_user()'s
      -- profile-email fallback.
      SELECT p.email INTO v_profile_email
      FROM profiles p WHERE p.id = NEW.reported_user_id;
      v_email := COALESCE(v_email, v_profile_email);

      IF v_email IS NOT NULL OR v_apple_sub IS NOT NULL OR v_phone IS NOT NULL THEN
        INSERT INTO banned_identifiers
          (email, apple_sub, phone_number, reason, banned_by, banned_at)
        VALUES
          (v_email, v_apple_sub, v_phone, 'Automated report threshold reached', NULL, now());
      END IF;

      INSERT INTO moderation_actions
        (action, target_user_id, target_email, target_apple_sub, reason, performed_by, metadata)
      VALUES
        ('auto_ban', NEW.reported_user_id, v_email, v_apple_sub,
         'Automated report threshold reached', NULL,
         jsonb_build_object('report_count', report_count));
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.moderation_automation_failures
    (operation, target_user_id, error_code, error_message)
  VALUES
    ('auto_ban_reported_user', NEW.reported_user_id, SQLSTATE, left(SQLERRM, 500));
  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF to_regclass('public.moderation_automation_failures') IS NULL THEN
    RAISE EXCEPTION 'moderation_automation_failures table is missing';
  END IF;
  IF position('DELETE FROM auth.refresh_tokens' IN pg_get_functiondef('public.auto_ban_reported_user()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'auto_ban_reported_user is missing the session-kill step';
  END IF;
  IF position('moderation_automation_failures' IN pg_get_functiondef('public.auto_ban_reported_user()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'auto_ban_reported_user is missing durable failure logging';
  END IF;
  IF position('report_count >= 3' IN pg_get_functiondef('public.auto_ban_reported_user()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'auto_ban_reported_user threshold logic changed unexpectedly -- this migration must not touch policy';
  END IF;
END $$;

COMMIT;
