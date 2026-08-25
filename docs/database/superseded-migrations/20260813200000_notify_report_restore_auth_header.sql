-- ARCHIVED. NON-EXECUTABLE. SUPERSEDED BY THE VAULT-BASED NOTIFICATION CHAIN.
-- Restore the Authorization header on the notify-report DB trigger.
--
-- 20260307100000_report_email_alert.sql originally sent
-- `Authorization: Bearer <service_role_key>`. The very next migration that
-- same day, 20260307211345_fix_report_trigger_http_call.sql, replaced this
-- function to "remove broken auth header" and noted the edge function was
-- "redeployed with --no-verify-jwt so no Authorization needed" -- which left
-- notify-report with ZERO authentication of any kind ever since: any caller
-- who finds the URL can POST an arbitrary `record` and get it emailed to
-- hello@washedup.app as a fabricated abuse report, unescaped into the HTML
-- body (see notify-report/index.ts).
--
-- The notify-report edge function has been fixed to require this header
-- again (compares it against SUPABASE_SERVICE_ROLE_KEY with a constant-time
-- check) and to HTML-escape every interpolated field. This migration is the
-- other half of that fix: without it, the trigger keeps sending no
-- Authorization header, the function 403s every call, and report alerts to
-- hello@washedup.app silently stop arriving entirely. Deploy both halves in
-- the same window.
--
-- VERIFY LIVE BEFORE RELYING ON THIS: `current_setting('app.settings.service_role_key', true)`
-- is the exact setting that was implicated as "broken" on 2026-03-07 for
-- this same trigger. Confirm it actually resolves to the real service role
-- key on the live database (e.g. as a superuser: `SHOW app.settings.service_role_key;`,
-- or check Supabase Dashboard -> Database -> Custom Postgres Config) before
-- shipping this. notify-plan-posted's trigger
-- (20260403000000_notify_plan_posted_trigger.sql, created chronologically
-- AFTER this GUC was implicated as broken) relies on the exact same setting
-- and was never revisited -- if the GUC is genuinely unset, that trigger's
-- Authorization header has likely been arriving empty too, meaning plan-
-- posted alerts may already be silently failing today. If the GUC turns out
-- to be unreliable, switch both triggers to a dedicated x-run-token header
-- (see ticket-inbox-drain / ticket-payout-release for that pattern) instead
-- of retrying this GUC.
CREATE OR REPLACE FUNCTION notify_report_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  service_key text;
BEGIN
  service_key := current_setting('app.settings.service_role_key', true);

  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-report',
    body := json_build_object('record', row_to_json(NEW))::jsonb,
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(service_key, '')
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
