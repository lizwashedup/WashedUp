-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
-- send-push-notifications requires an x-run-token header matching the SEND_PUSH_RUN_TOKEN edge
-- function secret (see that function's own file header). Until this trigger sends that header,
-- every push is rejected with 403 forbidden.
--
-- Built directly on this repo's own proven pattern (20260815120100_notify_tokens_to_vault.sql):
-- the token lives in vault.decrypted_secrets and is read at call time, never a plaintext literal
-- in the function body. pg_proc is catalog-readable and washedup_monitor_ro deliberately has
-- pg_proc access while being deliberately denied vault.decrypted_secrets access (see
-- 20260826010000_add_server_monitor_readonly_role.sql) -- a literal token here would hand that
-- read-only role a raw secret it was specifically built to never be able to read. Same reasoning
-- this repo already applied to notify_report_alert() and notify_plan_posted(); this is the third
-- and last such function, not a new instance of the retired pattern.
--
-- PRECONDITION: vault secret 'send_push_run_token' must already exist and match what
-- SEND_PUSH_RUN_TOKEN is set to in edge-function secrets. The guard below refuses to apply
-- otherwise, same as the vault migration this one is modeled on.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'send_push_run_token' AND coalesce(decrypted_secret, '') <> ''
  ) THEN
    RAISE EXCEPTION
      'refusing to apply: vault secret send_push_run_token missing or empty. Create it (matching the SEND_PUSH_RUN_TOKEN edge-function secret) first, or every push notification silently 403s forever.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trigger_send_push_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  run_token text;
BEGIN
  SELECT decrypted_secret INTO run_token
  FROM vault.decrypted_secrets
  WHERE name = 'send_push_run_token';

  -- No token means the request would 403 anyway; skip rather than send an
  -- unauthenticated POST that just burns a failed call.
  IF coalesce(run_token, '') = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/send-push-notifications',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-run-token', run_token
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the notification insert if the HTTP call fails
  RETURN NEW;
END;
$$;

-- Trigger itself (on_app_notification_inserted on app_notifications) is unchanged; CREATE OR
-- REPLACE FUNCTION above is sufficient since the trigger already points at
-- trigger_send_push_notifications() by name.

DO $$
DECLARE
  bad text;
  n_ok int;
BEGIN
  SELECT proname INTO bad
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'trigger_send_push_notifications'
    AND (prosrc ~ '[0-9a-f]{32,}' OR prosrc ~ '__SEND_PUSH_RUN_TOKEN__');

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-test failed: % still carries a literal token placeholder or value in the function body', bad;
  END IF;

  SELECT count(*) INTO n_ok
  FROM vault.decrypted_secrets
  WHERE name = 'send_push_run_token' AND coalesce(decrypted_secret, '') <> '';

  IF n_ok <> 1 THEN
    RAISE EXCEPTION 'self-test failed: expected 1 resolvable vault token, got %', n_ok;
  END IF;

  IF (SELECT count(*) FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal
        AND p.proname = 'trigger_send_push_notifications') < 1 THEN
    RAISE EXCEPTION 'self-test failed: expected the trigger to still be attached';
  END IF;

  RAISE NOTICE 'passed: no literal token in the function body, vault secret resolves, trigger attached';
END $$;

COMMIT;
