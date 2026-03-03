-- ══════════════════════════════════════════════════════════════════════
-- Unified notification system: waitlist spots, broadcasts, event reminders
-- ══════════════════════════════════════════════════════════════════════

-- 1. The notifications table
CREATE TABLE IF NOT EXISTS app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('waitlist_spot', 'broadcast', 'event_reminder')),
  title text NOT NULL,
  body text,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'acted', 'expired')),
  expires_at timestamptz,
  push_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_notifications"
  ON app_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "users_update_own_notifications"
  ON app_notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE INDEX idx_app_notifications_user
  ON app_notifications (user_id, status, created_at DESC);

CREATE INDEX idx_app_notifications_push
  ON app_notifications (push_sent, status)
  WHERE push_sent = false AND status = 'unread';

-- 2. Broadcasts table (admin-only insert)
CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_can_read_broadcasts"
  ON broadcasts FOR SELECT
  USING (true);

CREATE POLICY "admins_insert_broadcasts"
  ON broadcasts FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- 3. Waitlist spot notification trigger
-- Fires when waitlist_notification_queue gets a new row (spot opened)
-- Creates an app_notification with proper expiry:
--   - 24h from now, OR 1h before event start_time, whichever is sooner
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
    'A spot opened up!',
    'A spot just opened in "' || COALESCE(v_event_title, 'a plan') || '". Claim it before it expires!',
    NEW.event_id,
    v_expiry
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_waitlist_spot_opened
  AFTER INSERT ON waitlist_notification_queue
  FOR EACH ROW
  EXECUTE FUNCTION create_waitlist_spot_notification();

-- 4. Broadcast delivery function
-- When an admin creates a broadcast, fan it out to all active users
CREATE OR REPLACE FUNCTION deliver_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO app_notifications (user_id, type, title, body)
  SELECT
    p.id,
    'broadcast',
    NEW.title,
    NEW.body
  FROM profiles p
  WHERE p.onboarding_status = 'complete';

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_broadcast_created
  AFTER INSERT ON broadcasts
  FOR EACH ROW
  EXECUTE FUNCTION deliver_broadcast();

-- 5. Event reminder function (call via cron or Edge Function)
-- Creates reminder notifications for events starting in the next 2 hours
-- that haven't already been reminded
CREATE OR REPLACE FUNCTION create_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO app_notifications (user_id, type, title, body, event_id)
  SELECT
    em.user_id,
    'event_reminder',
    'Starting soon!',
    '"' || e.title || '" starts in about 2 hours. See you there!',
    e.id
  FROM events e
  JOIN event_members em ON em.event_id = e.id AND em.status = 'joined'
  WHERE e.status IN ('forming', 'active', 'full')
    AND e.start_time BETWEEN now() AND now() + interval '2 hours'
    AND NOT EXISTS (
      SELECT 1 FROM app_notifications an
      WHERE an.user_id = em.user_id
        AND an.event_id = e.id
        AND an.type = 'event_reminder'
    );
END;
$$;

-- 6. Auto-expire stale waitlist notifications
CREATE OR REPLACE FUNCTION expire_stale_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE app_notifications
  SET status = 'expired'
  WHERE status = 'unread'
    AND expires_at IS NOT NULL
    AND expires_at < now();
END;
$$;

-- 7. Admin RPC to send a broadcast
CREATE OR REPLACE FUNCTION admin_send_broadcast(
  p_title text,
  p_body text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO broadcasts (title, body, created_by)
  VALUES (p_title, p_body, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
