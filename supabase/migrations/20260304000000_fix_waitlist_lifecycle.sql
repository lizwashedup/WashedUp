-- ══════════════════════════════════════════════════════════════════════
-- Fix waitlist lifecycle: mark notified, clean up on response/expiry,
-- update notification wording
-- ══════════════════════════════════════════════════════════════════════

-- 0. Update waitlist spot notification wording
CREATE OR REPLACE FUNCTION create_waitlist_spot_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_title text;
  v_event_start timestamptz;
  v_expiry timestamptz;
  v_24h timestamptz;
  v_1h_before timestamptz;
BEGIN
  SELECT title, start_time INTO v_event_title, v_event_start
  FROM events WHERE id = NEW.event_id;

  v_24h := now() + interval '24 hours';

  IF v_event_start IS NOT NULL THEN
    v_1h_before := v_event_start - interval '1 hour';
    IF v_1h_before < v_24h THEN
      v_expiry := v_1h_before;
    ELSE
      v_expiry := v_24h;
    END IF;
    IF v_expiry < now() THEN
      v_expiry := now() + interval '15 minutes';
    END IF;
  ELSE
    v_expiry := v_24h;
  END IF;

  INSERT INTO app_notifications (user_id, type, title, body, event_id, expires_at)
  VALUES (
    NEW.user_id,
    'waitlist_spot',
    'You''re off the waitlist for ' || COALESCE(v_event_title, 'a plan') || '!',
    'Claim your spot before someone else does!',
    NEW.event_id,
    v_expiry
  );

  RETURN NEW;
END;
$$;

-- 1. Fix the spot-open trigger to mark users as notified
CREATE OR REPLACE FUNCTION notify_waitlist_on_spot_open()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id uuid;
  v_member_count int;
  v_max_invites int;
BEGIN
  IF NEW.status <> 'left' OR (OLD.status = 'left' AND NEW.status = 'left') THEN
    RETURN NEW;
  END IF;

  v_event_id := NEW.event_id;

  SELECT e.member_count, e.max_invites
  INTO v_member_count, v_max_invites
  FROM events e
  WHERE e.id = v_event_id;

  IF v_member_count IS NULL OR v_max_invites IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_member_count >= v_max_invites THEN
    RETURN NEW;
  END IF;

  -- Queue notifications for un-notified waitlist users
  INSERT INTO waitlist_notification_queue (event_id, user_id)
  SELECT w.event_id, w.user_id
  FROM event_waitlist w
  WHERE w.event_id = v_event_id
    AND w.notified = false;

  -- Mark them as notified so they won't be queued again
  UPDATE event_waitlist
  SET notified = true
  WHERE event_id = v_event_id
    AND notified = false;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. When a waitlist_spot notification is acted on, read, or expired,
--    remove the user from the waitlist so they stop getting notifications
CREATE OR REPLACE FUNCTION cleanup_waitlist_on_response()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type <> 'waitlist_spot' THEN
    RETURN NEW;
  END IF;

  -- Only act when status changes from 'unread' to something else
  IF OLD.status = 'unread' AND NEW.status IN ('acted', 'read', 'expired') THEN
    DELETE FROM event_waitlist
    WHERE event_id = NEW.event_id
      AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_waitlist_notification_response ON app_notifications;
CREATE TRIGGER on_waitlist_notification_response
  AFTER UPDATE OF status ON app_notifications
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_waitlist_on_response();

-- 3. Update expire_stale_notifications to also clean up expired waitlist entries
CREATE OR REPLACE FUNCTION expire_stale_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Expire notifications past their deadline
  UPDATE app_notifications
  SET status = 'expired'
  WHERE status = 'unread'
    AND expires_at IS NOT NULL
    AND expires_at < now();

  -- The trigger above (cleanup_waitlist_on_response) will automatically
  -- remove expired waitlist entries when their notification status changes
END;
$$;
