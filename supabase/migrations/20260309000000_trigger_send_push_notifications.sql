-- Trigger send-push-notifications edge function after every app_notification insert.
-- The function is a batch processor: it reads all push_sent=false rows and sends them.
-- Multiple concurrent calls are safe (idempotent — marks sent rows before the next call sees them).

CREATE OR REPLACE FUNCTION trigger_send_push_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/send-push-notifications',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the notification insert if the HTTP call fails
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_app_notification_inserted ON app_notifications;
CREATE TRIGGER on_app_notification_inserted
  AFTER INSERT ON app_notifications
  FOR EACH ROW
  EXECUTE FUNCTION trigger_send_push_notifications();
