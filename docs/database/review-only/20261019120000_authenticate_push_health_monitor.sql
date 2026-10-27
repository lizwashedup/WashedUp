-- REVIEW ONLY. Not a migration and not applied by this coding task.
-- Run only after explicit production approval and matching Vault/Edge secrets.
-- Update the scheduler BEFORE deploying the authenticated Edge handler.
-- This changes only the existing five-minute monitor job, not delivery gates.
BEGIN;

DO $preflight$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'run the approved scheduler change as postgres';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'monitor-push-health') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'monitor-push-health'
       AND active AND schedule = '*/5 * * * *' AND username = 'postgres') <> 1 THEN
    RAISE EXCEPTION 'monitor schedule missing, duplicated, inactive, or changed';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets
      WHERE name = 'monitor_push_health_run_token'
        AND nullif(btrim(decrypted_secret), '') IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'exactly one nonempty monitor token is required in Vault';
  END IF;
  IF to_regprocedure('public.run_push_health_monitor_authenticated()') IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated monitor wrapper already exists; inspect before changing it';
  END IF;
END
$preflight$;

CREATE FUNCTION public.run_push_health_monitor_authenticated()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE v_token text; v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO STRICT v_token
  FROM vault.decrypted_secrets WHERE name = 'monitor_push_health_run_token';
  IF nullif(btrim(v_token), '') IS NULL THEN
    RAISE EXCEPTION 'monitor run token unavailable';
  END IF;
  SELECT net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/monitor-push-health',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-run-token', v_token),
    timeout_milliseconds := 45000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_push_health_monitor_authenticated()
FROM PUBLIC, anon, authenticated, service_role;

DO $schedule$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO STRICT v_jobid FROM cron.job WHERE jobname = 'monitor-push-health';
  PERFORM cron.alter_job(job_id := v_jobid,
    command := 'select public.run_push_health_monitor_authenticated();');
END
$schedule$;

DO $postflight$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'monitor-push-health'
      AND active AND schedule = '*/5 * * * *' AND username = 'postgres'
      AND command = 'select public.run_push_health_monitor_authenticated();') <> 1 THEN
    RAISE EXCEPTION 'authenticated monitor schedule verification failed';
  END IF;
  IF has_function_privilege('anon', 'public.run_push_health_monitor_authenticated()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.run_push_health_monitor_authenticated()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.run_push_health_monitor_authenticated()', 'EXECUTE') THEN
    RAISE EXCEPTION 'monitor wrapper is exposed to an API role';
  END IF;
END
$postflight$;
COMMIT;
