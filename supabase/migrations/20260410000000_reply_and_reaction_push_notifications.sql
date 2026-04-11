-- ══════════════════════════════════════════════════════════════════════
-- Reply and reaction push notifications
--
-- 1. When a message is a reply (reply_to_message_id IS NOT NULL),
--    the parent message's author gets a dedicated "replied to you"
--    notification, bypassing the 30s dedupe. Other members still get
--    the regular new_message fanout, but the parent author is excluded
--    from that loop to avoid a double push.
--
-- 2. A new trigger on message_reactions fires on INSERT or UPDATE
--    (the second path covers "switched reaction" cases) and notifies
--    the message author that someone reacted to their message.
--
-- Both new notifications reuse type='new_message' so the chat tab
-- badge, _layout.tsx filters, and InboxModal exclusion keep working
-- without any client-side changes.
-- ══════════════════════════════════════════════════════════════════════

-- ── 1. Update notify_new_chat_message to handle replies specifically ──

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
  v_parent_author uuid;
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

  -- If this message is a reply, resolve the parent author and send a
  -- dedicated "replied to you" notification (unless replying to self).
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

  -- Fanout to every other joined member, skipping the parent author
  -- (who already got the dedicated reply notification above).
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
$$;

-- ── 2. Reaction notifications ──

CREATE OR REPLACE FUNCTION notify_message_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reactor_name text;
  v_msg_author uuid;
  v_msg_content text;
  v_msg_image text;
  v_event_id uuid;
  v_emoji_display text;
  v_body text;
BEGIN
  -- Only notify on genuinely new reactions. UPDATE covers the
  -- "swapped one emoji for another" path in toggleReaction, but we
  -- skip if the reaction text didn't actually change.
  IF TG_OP = 'UPDATE' AND NEW.reaction IS NOT DISTINCT FROM OLD.reaction THEN
    RETURN NEW;
  END IF;

  SELECT m.user_id, m.content, m.image_url, m.event_id
    INTO v_msg_author, v_msg_content, v_msg_image, v_event_id
  FROM messages m
  WHERE m.id = NEW.message_id;

  IF v_msg_author IS NULL OR v_msg_author = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT first_name_display INTO v_reactor_name
  FROM profiles WHERE id = NEW.user_id;

  v_emoji_display := CASE NEW.reaction
    WHEN 'heart'    THEN '❤️'
    WHEN 'thumbsup' THEN '👍'
    WHEN 'laugh'    THEN '😂'
    WHEN 'surprise' THEN '😮'
    WHEN 'cry'      THEN '😢'
    WHEN 'pray'     THEN '🙏'
    ELSE NEW.reaction
  END;

  v_body := CASE
    WHEN v_msg_image IS NOT NULL AND (v_msg_content IS NULL OR v_msg_content = '')
      THEN 'to your photo'
    WHEN v_msg_content IS NULL OR v_msg_content = ''
      THEN 'to your message'
    WHEN length(v_msg_content) > 80
      THEN left(v_msg_content, 77) || '...'
    ELSE v_msg_content
  END;

  INSERT INTO app_notifications (user_id, type, title, body, event_id)
  VALUES (
    v_msg_author,
    'new_message',
    COALESCE(v_reactor_name, 'Someone') || ' reacted ' || v_emoji_display,
    v_body,
    v_event_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_message_reaction ON message_reactions;
CREATE TRIGGER on_message_reaction
  AFTER INSERT OR UPDATE ON message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION notify_message_reaction();
