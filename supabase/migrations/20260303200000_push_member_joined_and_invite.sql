-- ══════════════════════════════════════════════════════════════════════
-- Push notifications for member joins + plan invite delivery
-- ══════════════════════════════════════════════════════════════════════

-- 1. Expand the type constraint to allow 'member_joined' and 'plan_invite'
ALTER TABLE app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;

ALTER TABLE app_notifications
  ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN ('waitlist_spot', 'broadcast', 'event_reminder', 'member_joined', 'plan_invite'));

-- 2. Trigger: when someone joins a plan, notify the creator + existing members
CREATE OR REPLACE FUNCTION notify_member_joined()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_joiner_name text;
  v_event_title text;
  v_member_row RECORD;
BEGIN
  IF NEW.status <> 'joined' THEN
    RETURN NEW;
  END IF;

  SELECT first_name_display INTO v_joiner_name
  FROM profiles WHERE id = NEW.user_id;

  SELECT title INTO v_event_title
  FROM events WHERE id = NEW.event_id;

  FOR v_member_row IN
    SELECT DISTINCT user_id
    FROM event_members
    WHERE event_id = NEW.event_id
      AND status = 'joined'
      AND user_id <> NEW.user_id
  LOOP
    INSERT INTO app_notifications (user_id, type, title, body, event_id)
    VALUES (
      v_member_row.user_id,
      'member_joined',
      COALESCE(v_joiner_name, 'Someone') || ' joined your group!',
      COALESCE(v_joiner_name, 'Someone') || ' just joined "' || COALESCE(v_event_title, 'your plan') || '". Go say hi!',
      NEW.event_id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_member_joined ON event_members;
CREATE TRIGGER on_member_joined
  AFTER INSERT ON event_members
  FOR EACH ROW
  EXECUTE FUNCTION notify_member_joined();

-- 3. Update plan invite trigger to create an app_notification
CREATE OR REPLACE FUNCTION notify_plan_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_event_title text;
BEGIN
  SELECT first_name_display INTO v_sender_name
  FROM profiles WHERE id = NEW.sender_id;

  SELECT title INTO v_event_title
  FROM events WHERE id = NEW.event_id;

  INSERT INTO app_notifications (user_id, type, title, body, event_id)
  VALUES (
    NEW.recipient_id,
    'plan_invite',
    COALESCE(v_sender_name, 'Someone') || ' invited you!',
    'You''re invited to "' || COALESCE(v_event_title, 'a plan') || '". Check it out!',
    NEW.event_id
  );

  RETURN NEW;
END;
$$;
