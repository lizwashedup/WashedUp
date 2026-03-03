-- Notify the sender when their invite is accepted

-- 1. Expand type constraint to include 'invite_accepted'
ALTER TABLE app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;

ALTER TABLE app_notifications
  ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN ('waitlist_spot', 'broadcast', 'event_reminder', 'member_joined', 'plan_invite', 'invite_accepted'));

-- 2. Trigger on plan_invites UPDATE: when status changes to 'accepted', notify sender
CREATE OR REPLACE FUNCTION notify_invite_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_name text;
  v_event_title text;
BEGIN
  IF NEW.status <> 'accepted' OR OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT first_name_display INTO v_recipient_name
  FROM profiles WHERE id = NEW.recipient_id;

  SELECT title INTO v_event_title
  FROM events WHERE id = NEW.event_id;

  INSERT INTO app_notifications (user_id, type, title, body, event_id)
  VALUES (
    NEW.sender_id,
    'invite_accepted',
    COALESCE(v_recipient_name, 'Someone') || ' can come!',
    COALESCE(v_recipient_name, 'Someone') || ' accepted your invite to "' || COALESCE(v_event_title, 'your plan') || '".',
    NEW.event_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_invite_accepted ON plan_invites;
CREATE TRIGGER on_invite_accepted
  AFTER UPDATE OF status ON plan_invites
  FOR EACH ROW
  EXECUTE FUNCTION notify_invite_accepted();
