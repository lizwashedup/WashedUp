-- notify_report_alert() and notify_plan_posted() are the last two functions in
-- this database that carry a run-token as a plaintext literal in their own
-- body. Confirmed live 2026-08-15: both contain a bare 64-char hex token inside
-- json_build_object(...,'x-run-token','<literal>'), and pg_proc is catalog-
-- readable (has_table_privilege('anon','pg_catalog.pg_proc','SELECT') is true),
-- so the value sits somewhere anything with database access can read it instead
-- of in a secrets store. Not reachable over HTTP: PostgREST does not expose
-- pg_catalog, and no public view or SECURITY DEFINER function reads pg_proc.
--
-- The rest of this codebase already solved this. Cron jobs 40
-- (send-application-emails), 47 (ticket-inbox-drain) and 53
-- (ticket-payout-release) all pull their run-token from vault.decrypted_secrets
-- at call time and hold no literal at all. This brings the two notification
-- triggers onto that same pattern. vault.decrypted_secrets is not readable by
-- anon or authenticated (verified 2026-08-15), and both functions are SECURITY
-- DEFINER owned by postgres, so the lookup resolves.
--
-- THE VALUE IS NOT ROTATED HERE, ON PURPOSE. This moves the existing token out
-- of the function body without changing it, so it applies on its own with no
-- coordination and no window where the trigger and the edge function disagree.
-- Rotating the value is a separate step (tracked, not in this file) that
-- updates the vault secret and the matching Supabase edge-function secret
-- together, since both triggers swallow every exception and the HTTP call is
-- fire-and-forget: a value mismatch fails silently with nothing to alert on.
--
-- PRECONDITION: vault secrets 'notify_report_run_token' and
-- 'notify_plan_posted_run_token' must already exist and match what
-- NOTIFY_REPORT_RUN_TOKEN / NOTIFY_PLAN_POSTED_RUN_TOKEN are set to in
-- edge-function secrets. The guard below refuses to apply otherwise.

BEGIN;

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['notify_report_run_token', 'notify_plan_posted_run_token'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = n AND coalesce(decrypted_secret, '') <> ''
    ) THEN
      missing := missing || n;
    END IF;
  END LOOP;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing to apply: vault secret(s) % missing or empty. Create them from the value currently in the function body first, or every notification silently stops.',
      array_to_string(missing, ', ');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION notify_report_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  run_token text;
BEGIN
  SELECT decrypted_secret INTO run_token
  FROM vault.decrypted_secrets
  WHERE name = 'notify_report_run_token';

  -- No token means the request would 403 anyway; skip rather than send an
  -- unauthenticated POST.
  IF coalesce(run_token, '') = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-report',
    body := json_build_object('record', row_to_json(NEW))::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-run-token', run_token
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the report insert if the notification fails
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_plan_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  run_token text;
BEGIN
  SELECT decrypted_secret INTO run_token
  FROM vault.decrypted_secrets
  WHERE name = 'notify_plan_posted_run_token';

  IF coalesce(run_token, '') = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-plan-posted',
    body := json_build_object('record', row_to_json(NEW))::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-run-token', run_token
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the plan insert if the notification fails
  RETURN NEW;
END;
$$;

-- Triggers themselves (on_report_inserted on reports, on_plan_posted on events)
-- are unchanged; CREATE OR REPLACE FUNCTION is sufficient since both already
-- point at these functions by name.

DO $$
DECLARE
  bad text;
  n_ok int;
BEGIN
  SELECT string_agg(proname, ', ') INTO bad
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('notify_report_alert', 'notify_plan_posted')
    AND prosrc ~ '[0-9a-f]{32,}';

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'self-test failed: % still carr(ies) a hex literal in the function body', bad;
  END IF;

  SELECT count(*) INTO n_ok
  FROM vault.decrypted_secrets
  WHERE name IN ('notify_report_run_token', 'notify_plan_posted_run_token')
    AND coalesce(decrypted_secret, '') <> '';

  IF n_ok <> 2 THEN
    RAISE EXCEPTION 'self-test failed: expected 2 resolvable vault tokens, got %', n_ok;
  END IF;

  IF (SELECT count(*) FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal
        AND p.proname IN ('notify_report_alert', 'notify_plan_posted')) <> 2 THEN
    RAISE EXCEPTION 'self-test failed: expected both triggers still attached';
  END IF;

  RAISE NOTICE 'passed: no literal tokens in either body, both vault secrets resolve, both triggers attached';
END $$;

COMMIT;
