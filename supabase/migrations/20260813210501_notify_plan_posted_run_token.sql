-- Same fix, same reason, as 20260813210500_notify_report_run_token.sql: the Postgres setting
-- this trigger relied on (app.settings.service_role_key) is permanently unsettable on this
-- project, confirmed live 2026-08-13. Switches to the same dedicated run-token pattern as
-- ticket-inbox-drain / ticket-payout-release.
--
-- NOTE: this file is a template, same convention as the notify-report companion migration.
-- __NOTIFY_PLAN_POSTED_RUN_TOKEN__ below is a placeholder; the live database has the real
-- value from NOTIFY_PLAN_POSTED_RUN_TOKEN (Supabase secrets), applied 2026-08-13.

CREATE OR REPLACE FUNCTION notify_plan_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-plan-posted',
    body := json_build_object('record', row_to_json(NEW))::jsonb,
    headers := json_build_object(
      'Content-Type', 'application/json',
      'x-run-token', '__NOTIFY_PLAN_POSTED_RUN_TOKEN__'
    )::jsonb
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the plan insert if the notification fails
  RETURN NEW;
END;
$$;

-- Trigger itself (on_plan_posted on events) is unchanged; CREATE OR REPLACE
-- FUNCTION above is sufficient since the trigger already points at
-- notify_plan_posted() by name.
