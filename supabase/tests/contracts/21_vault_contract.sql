\set ON_ERROR_STOP on

INSERT INTO public.reports (id, reason)
VALUES ('40000000-0000-0000-0000-000000000001', 'fixture');

INSERT INTO public.events (id, title)
VALUES ('50000000-0000-0000-0000-000000000001', 'fixture');

DO $$
DECLARE
  report_count integer;
  plan_count integer;
BEGIN
  SELECT count(*) INTO report_count
  FROM public.test_http_capture
  WHERE url = 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-report'
    AND headers ->> 'x-run-token' = 'fixture-report-token'
    AND headers ->> 'Content-Type' = 'application/json'
    AND body #>> '{record,id}' = '40000000-0000-0000-0000-000000000001';

  SELECT count(*) INTO plan_count
  FROM public.test_http_capture
  WHERE url = 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-plan-posted'
    AND headers ->> 'x-run-token' = 'fixture-plan-token'
    AND headers ->> 'Content-Type' = 'application/json'
    AND body #>> '{record,id}' = '50000000-0000-0000-0000-000000000001';

  IF report_count <> 1 OR plan_count <> 1 THEN
    RAISE EXCEPTION 'vault contract failed: report captures %, plan captures %', report_count, plan_count;
  END IF;
END $$;

SELECT 'PASS Vault fixture: precondition, trigger attachment, and captured x-run-token headers' AS result;
