-- Enable pg_net for async HTTP from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Trigger function: calls notify-report Edge Function on every reports INSERT
CREATE OR REPLACE FUNCTION notify_report_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edge_url text := 'https://upstjumasqblszevlgik.supabase.co';
  service_key text;
BEGIN
  service_key := current_setting('app.settings.service_role_key', true);

  PERFORM extensions.http_post(
    url := edge_url || '/functions/v1/notify-report',
    body := json_build_object('record', row_to_json(NEW))::text,
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

-- Attach trigger to reports table
DROP TRIGGER IF EXISTS on_report_inserted ON reports;
CREATE TRIGGER on_report_inserted
  AFTER INSERT ON reports
  FOR EACH ROW
  EXECUTE FUNCTION notify_report_alert();
