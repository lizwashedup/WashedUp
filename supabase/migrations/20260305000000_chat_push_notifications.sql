-- ══════════════════════════════════════════════════════════════════════
-- Push notifications for new chat messages
-- Fires on INSERT into messages table, notifies other joined members
-- ══════════════════════════════════════════════════════════════════════

-- 1. Expand the type constraint to include 'new_message'
ALTER TABLE app_notifications
  DROP CONSTRAINT IF EXISTS app_notifications_type_check;

ALTER TABLE app_notifications
  ADD CONSTRAINT app_notifications_type_check
  CHECK (type IN (
    'waitlist_spot', 'broadcast', 'event_reminder',
    'member_joined', 'plan_invite', 'new_message'
  ));

-- 2. Trigger function: fan out a notification to every other joined member
CREATE OR REPLACE FUNCTION notify_new_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_event_title text;
  v_body text;
  v_member_row RECORD;
  v_recent_exists boolean;
BEGIN
  -- Skip system messages (e.g. "joined the plan")
  IF NEW.message_type = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT first_name_display INTO v_sender_name
  FROM profiles WHERE id = NEW.user_id;

  SELECT title INTO v_event_title
  FROM events WHERE id = NEW.event_id;

  -- Truncate long messages for the push body
  v_body := CASE
    WHEN NEW.image_url IS NOT NULL AND (NEW.content IS NULL OR NEW.content = '')
      THEN COALESCE(v_sender_name, 'Someone') || ' sent a photo'
    WHEN length(NEW.content) > 120
      THEN left(NEW.content, 117) || '...'
    ELSE NEW.content
  END;

  FOR v_member_row IN
    SELECT DISTINCT user_id
    FROM event_members
    WHERE event_id = NEW.event_id
      AND status = 'joined'
      AND user_id <> NEW.user_id
  LOOP
    -- Deduplicate: skip if there's already an unread new_message notification
    -- for this event from the last 30 seconds
    SELECT EXISTS (
      SELECT 1 FROM app_notifications
      WHERE user_id = v_member_row.user_id
        AND event_id = NEW.event_id
        AND type = 'new_message'
        AND status = 'unread'
        AND created_at > now() - interval '30 seconds'
    ) INTO v_recent_exists;

    IF NOT v_recent_exists THEN
      INSERT INTO app_notifications (user_id, type, title, body, event_id)
      VALUES (
        v_member_row.user_id,
        'new_message',
        COALESCE(v_sender_name, 'Someone') || ' in ' || COALESCE(v_event_title, 'your plan'),
        v_body,
        NEW.event_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_new_chat_message ON messages;
CREATE TRIGGER on_new_chat_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_chat_message();
