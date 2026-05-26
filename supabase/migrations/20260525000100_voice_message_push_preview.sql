-- Voice-message push preview (chat upgrade Component 5 follow-up).
--
-- The chat push body is built in the notify_new_chat_message() trigger, NOT in
-- the send-push edge function. Without this, a voice message (message_type
-- 'audio', empty content, no image_url) falls through to ELSE NEW.content and
-- produces an EMPTY push body. Add an 'audio' branch so the notification reads
-- "<name> sent a voice message", matching the photo branch and the chat-list
-- preview text.
--
-- Reproduced verbatim from the live prod definition (read 2026-05-24) so no
-- drift is clobbered; the only change is the new first WHEN in the v_body CASE.

CREATE OR REPLACE FUNCTION public.notify_new_chat_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender_name text;
  v_event_title text;
  v_body text;
  v_member_row RECORD;
  v_recent_exists boolean;
  v_parent_author uuid;
BEGIN
  IF NEW.message_type = 'system' THEN
    RETURN NEW;
  END IF;

  SELECT first_name_display INTO v_sender_name
  FROM profiles WHERE id = NEW.user_id;

  SELECT title INTO v_event_title
  FROM events WHERE id = NEW.event_id;

  v_body := CASE
    WHEN NEW.message_type = 'audio'
      THEN COALESCE(v_sender_name, 'Someone') || ' sent a voice message'
    WHEN NEW.image_url IS NOT NULL AND (NEW.content IS NULL OR NEW.content = '')
      THEN COALESCE(v_sender_name, 'Someone') || ' sent a photo'
    WHEN length(NEW.content) > 120
      THEN left(NEW.content, 117) || '...'
    ELSE NEW.content
  END;

  IF NEW.reply_to_message_id IS NOT NULL THEN
    SELECT user_id INTO v_parent_author
    FROM messages
    WHERE id = NEW.reply_to_message_id;

    IF v_parent_author IS NOT NULL AND v_parent_author <> NEW.user_id THEN
      INSERT INTO app_notifications (user_id, type, title, body, event_id)
      VALUES (
        v_parent_author,
        'new_message',
        COALESCE(v_sender_name, 'Someone') || ' replied to you',
        v_body,
        NEW.event_id
      );
    END IF;
  END IF;

  FOR v_member_row IN
    SELECT DISTINCT user_id
    FROM event_members
    WHERE event_id = NEW.event_id
      AND status = 'joined'
      AND user_id <> NEW.user_id
      AND (v_parent_author IS NULL OR user_id <> v_parent_author)
  LOOP
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
$function$;
