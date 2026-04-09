-- Fix: use net.http_post (correct schema) with jsonb body, remove broken auth header
-- Edge Function redeployed with --no-verify-jwt so no Authorization needed
CREATE OR REPLACE FUNCTION notify_report_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/notify-report',
    body := json_build_object('record', row_to_json(NEW))::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
