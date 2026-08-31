\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT count(*) FROM cron.job WHERE active AND jobname = 'transactional-email-drain' AND schedule = '7,17,27,37,47,57 * * * *') <> 1
     OR (SELECT count(*) FROM cron.job WHERE active AND jobname = 'audience-sync-drain' AND schedule = '3,18,33,48 * * * *') <> 1
     OR (SELECT count(*) FROM cron.job WHERE active AND jobname = 'purge-audience-personal-data' AND schedule = '53 4 * * *') <> 1 THEN
    RAISE EXCEPTION 'scheduler contract failed exact cadence';
  END IF;
  IF has_function_privilege('anon', 'public.run_transactional_email_drain()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.run_audience_sync_drain()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.run_audience_sync_drain()', 'EXECUTE') THEN
    RAISE EXCEPTION 'scheduler wrapper ACL contract failed';
  END IF;
END $$;
SELECT public.run_transactional_email_drain();
SELECT public.run_audience_sync_drain();
DO $$ BEGIN
  IF (SELECT count(*) FROM net.requests) <> 2 THEN RAISE EXCEPTION 'scheduler wrappers did not make exactly two bounded requests'; END IF;
  IF EXISTS (SELECT 1 FROM net.requests WHERE body <> '{"limit": 10}'::jsonb OR timeout_ms <> 240000) THEN
    RAISE EXCEPTION 'scheduler wrapper request bounds drifted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM net.requests WHERE headers->>'x-run-token' = 'fixture-transactional-token')
     OR NOT EXISTS (SELECT 1 FROM net.requests WHERE headers->>'x-run-token' = 'fixture-audience-token') THEN
    RAISE EXCEPTION 'scheduler wrapper did not resolve both Vault tokens';
  END IF;
END $$;
SELECT 'PASS delivery scheduler Vault, cadence, request bounds, and ACL contracts' AS result;
