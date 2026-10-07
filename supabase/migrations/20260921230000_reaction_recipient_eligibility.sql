-- Only queue a reaction alert for a current, unblocked message author.
-- Preserve existing conversation identity, self/no-op behavior and permissions.
BEGIN;

CREATE OR REPLACE FUNCTION public.notify_message_reaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reactor_name text;
  v_msg_author uuid;
  v_msg_content text;
  v_msg_image text;
  v_event_id uuid;
  v_circle_id uuid;
  v_emoji_display text;
  v_body text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.reaction IS NOT DISTINCT FROM OLD.reaction THEN
    RETURN NEW;
  END IF;

  SELECT m.user_id, m.content, m.image_url, m.event_id, m.circle_id
    INTO v_msg_author, v_msg_content, v_msg_image, v_event_id, v_circle_id
  FROM messages m
  WHERE m.id = NEW.message_id;

  IF v_msg_author IS NULL OR v_msg_author = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Notification recipients need current conversation access too. Reaction
  -- writes already check the actor; a former author must not receive previews.
  IF public.yours_is_blocked_between(v_msg_author, NEW.user_id) THEN
    RETURN NEW;
  END IF;
  IF v_circle_id IS NOT NULL THEN
    IF NOT public.is_circle_member(v_circle_id, v_msg_author) THEN RETURN NEW; END IF;
  ELSIF v_event_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.event_members em
      WHERE em.event_id=v_event_id AND em.user_id=v_msg_author AND em.status='joined') THEN
      RETURN NEW;
    END IF;
  ELSE
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

  INSERT INTO app_notifications (user_id, type, title, body, event_id, circle_id)
  VALUES (
    v_msg_author,
    'new_message',
    COALESCE(v_reactor_name, 'Someone') || ' reacted ' || v_emoji_display,
    v_body,
    v_event_id,
    v_circle_id
  );

  RETURN NEW;
END;
$function$;

COMMIT;
