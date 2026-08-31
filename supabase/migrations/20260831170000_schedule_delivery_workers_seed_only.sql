-- G0 scheduler activation gate. This file is deliberately separate from the
-- two queue/schema migrations. Apply only after seed profiles/jobs are frozen,
-- both run tokens exist in Vault, the four function bundles are deployed, and
-- delivery_runtime_config is already seed_only.

BEGIN;

DO $preflight$
DECLARE v_missing text;
BEGIN
  IF (SELECT activation_mode FROM public.delivery_runtime_config WHERE singleton)
       IS DISTINCT FROM 'seed_only' THEN
    RAISE EXCEPTION 'refusing delivery schedules unless activation mode is seed_only';
  END IF;
  SELECT string_agg(required.name, ', ' ORDER BY required.name) INTO v_missing
  FROM (VALUES ('transactional_email_run_token'), ('audience_sync_run_token')) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
     WHERE s.name = required.name AND nullif(btrim(s.decrypted_secret), '') IS NOT NULL
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'refusing delivery schedules because Vault token(s) are missing or empty: %', v_missing;
  END IF;
  IF to_regprocedure('public.claim_transactional_email_jobs(integer,integer)') IS NULL
     OR to_regprocedure('public.claim_audience_sync_jobs(integer,integer)') IS NULL
     OR to_regprocedure('public.acquire_delivery_worker_lease(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'refusing delivery schedules because G0 queue functions are incomplete';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.run_transactional_email_drain()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault, net
AS $function$
DECLARE v_token text; v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
   WHERE name = 'transactional_email_run_token';
  IF nullif(btrim(v_token), '') IS NULL THEN
    RAISE EXCEPTION 'transactional email run token unavailable';
  END IF;
  SELECT net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/transactional-email-drain',
    body := jsonb_build_object('limit', 10),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-run-token', v_token),
    timeout_milliseconds := 240000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_audience_sync_drain()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault, net
AS $function$
DECLARE v_token text; v_request_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
   WHERE name = 'audience_sync_run_token';
  IF nullif(btrim(v_token), '') IS NULL THEN
    RAISE EXCEPTION 'audience sync run token unavailable';
  END IF;
  SELECT net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/audience-sync-drain',
    body := jsonb_build_object('limit', 10),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-run-token', v_token),
    timeout_milliseconds := 240000
  ) INTO v_request_id;
  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_transactional_email_drain(),
  public.run_audience_sync_drain() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule(
  'transactional-email-drain',
  '7,17,27,37,47,57 * * * *',
  $$select public.run_transactional_email_drain();$$
);
SELECT cron.schedule(
  'audience-sync-drain',
  '3,18,33,48 * * * *',
  $$select public.run_audience_sync_drain();$$
);
SELECT cron.schedule(
  'purge-audience-personal-data',
  '53 4 * * *',
  $$select public.purge_audience_personal_data(1000);$$
);

DO $postflight$
DECLARE v_bad text;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE active AND jobname = 'transactional-email-drain'
      AND schedule = '7,17,27,37,47,57 * * * *') <> 1
     OR (SELECT count(*) FROM cron.job WHERE active AND jobname = 'audience-sync-drain'
      AND schedule = '3,18,33,48 * * * *') <> 1
     OR (SELECT count(*) FROM cron.job WHERE active AND jobname = 'purge-audience-personal-data'
      AND schedule = '53 4 * * *') <> 1 THEN
    RAISE EXCEPTION 'delivery scheduler postflight failed';
  END IF;
  SELECT string_agg(p.proname, ', ') INTO v_bad FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('run_transactional_email_drain', 'run_audience_sync_drain')
     AND p.prosrc ~ '[A-Za-z0-9_-]{32,}';
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'delivery wrapper contains a token-like literal: %', v_bad; END IF;
  IF has_function_privilege('anon', 'public.run_transactional_email_drain()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.run_transactional_email_drain()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.run_transactional_email_drain()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.run_audience_sync_drain()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.run_audience_sync_drain()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.run_audience_sync_drain()', 'EXECUTE') THEN
    RAISE EXCEPTION 'delivery scheduler wrappers are callable by an application role';
  END IF;
END
$postflight$;

COMMIT;
