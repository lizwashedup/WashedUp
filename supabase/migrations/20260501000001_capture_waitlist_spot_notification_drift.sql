-- Capture create_waitlist_spot_notification() drift from prod.
-- Original migration 20260303100000_app_notifications.sql:61-110 used a simple
-- "24h or 1h before event" expiry. The prod version has been replaced with a
-- dynamic-by-proximity timeout (4h for >7d out, 2h for 1-7d, 0/30min for <24h)
-- and slightly different body copy. Captured from prod on 2026-05-01 via
-- SELECT pg_get_functiondef(...).
--
-- This migration brings repo state in sync with prod. No behavior change in prod.

CREATE OR REPLACE FUNCTION public.create_waitlist_spot_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_event_title text;
  v_event_start timestamptz;
  v_expiry timestamptz;
  v_hours_until_start float;
  v_timeout_hours int;
BEGIN
  SELECT title, start_time INTO v_event_title, v_event_start FROM events WHERE id = NEW.event_id;

  -- Dynamic timeout based on plan proximity
  IF v_event_start IS NOT NULL THEN
    v_hours_until_start := EXTRACT(EPOCH FROM (v_event_start - NOW())) / 3600.0;

    IF v_hours_until_start < 24 THEN
      v_timeout_hours := 0; -- Under 24h: no exclusive window, go public
    ELSIF v_hours_until_start < 48 THEN
      v_timeout_hours := 2;
    ELSIF v_hours_until_start < 168 THEN -- 7 days
      v_timeout_hours := 2;
    ELSE
      v_timeout_hours := 4;
    END IF;

    -- Expiry = min(timeout, 1 hour before event)
    IF v_timeout_hours > 0 THEN
      v_expiry := LEAST(
        NOW() + (v_timeout_hours || ' hours')::interval,
        v_event_start - interval '1 hour'
      );
    ELSE
      -- Urgent: 30 min window
      v_expiry := LEAST(NOW() + interval '30 minutes', v_event_start - interval '30 minutes');
    END IF;

    -- Safety: never expire in the past
    IF v_expiry < NOW() THEN
      v_expiry := NOW() + interval '15 minutes';
    END IF;
  ELSE
    v_expiry := NOW() + interval '4 hours';
  END IF;

  INSERT INTO app_notifications (user_id, type, title, body, event_id, expires_at)
  VALUES (
    NEW.user_id,
    'waitlist_spot',
    'A spot opened up!',
    'A spot just opened in "' || COALESCE(v_event_title, 'a plan') || '". Claim it before someone else does!',
    NEW.event_id,
    v_expiry
  );

  RETURN NEW;
END;
$function$;
