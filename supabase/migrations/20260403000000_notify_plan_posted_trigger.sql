-- Trigger: call notify-plan-posted edge function whenever a new plan/event is inserted.
-- Sends email to liz@washedup.app and push notification to admin devices.

CREATE OR REPLACE FUNCTION notify_plan_posted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  service_key text;
BEGIN
  service_key := current_setting('app.settings.service_role_key', true);

  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-plan-posted',
    body := json_build_object('record', row_to_json(NEW))::jsonb,
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(service_key, '')
    )::jsonb
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the plan insert if the notification fails
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_plan_posted ON events;
CREATE TRIGGER on_plan_posted
  AFTER INSERT ON events
  FOR EACH ROW
  EXECUTE FUNCTION notify_plan_posted();
