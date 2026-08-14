-- Replaces the previous fix attempt (20260813200000_notify_report_restore_auth_header.sql),
-- which relied on a Postgres setting (app.settings.service_role_key) that turned out to be
-- permanently unsettable on this project: Supabase returns 42501 permission denied even from
-- the dashboard SQL editor logged in as the postgres role, not just via CLI/Management API.
-- Confirmed live 2026-08-13.
--
-- Same dedicated run-token pattern already proven in this codebase for ticket-inbox-drain /
-- ticket-payout-release: a private value only this trigger and the notify-report function
-- know, unrelated to the service role key, no Postgres setting required.
--
-- NOTE: this file is a template. The real token is NOT committed here -- it's substituted in
-- and applied live directly, same convention as ticket-inbox-drain/ticket-payout-release's own
-- pg_cron setup (also never committed with a real token). __NOTIFY_REPORT_RUN_TOKEN__ below is
-- a placeholder; the live database has the real value from NOTIFY_REPORT_RUN_TOKEN (Supabase
-- secrets), applied 2026-08-13.

CREATE OR REPLACE FUNCTION notify_report_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-report',
    body := json_build_object('record', row_to_json(NEW))::jsonb,
    headers := json_build_object(
      'Content-Type', 'application/json',
      'x-run-token', '__NOTIFY_REPORT_RUN_TOKEN__'
    )::jsonb
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the report insert if the notification fails
  RETURN NEW;
END;
$$;

-- Trigger itself (on_report_inserted on reports) is unchanged; CREATE OR
-- REPLACE FUNCTION above is sufficient since the trigger already points at
-- notify_report_alert() by name.
