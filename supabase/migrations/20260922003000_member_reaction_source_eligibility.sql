-- Keep reaction provenance after removal so a stale author alert cannot revive.
-- Existing notification and reaction tables, RLS and client contracts stay intact.
BEGIN;
CREATE TABLE public.member_reaction_notification_sources (
 notification_id uuid PRIMARY KEY REFERENCES public.app_notifications(id) ON DELETE CASCADE,
 reaction_id uuid NOT NULL,
 message_id uuid NOT NULL,
 reactor_id uuid NOT NULL,
 reaction_value text NOT NULL,
 reaction_created_at timestamptz NOT NULL,
 UNIQUE(reaction_id,reaction_value,reaction_created_at)
);
ALTER TABLE public.member_reaction_notification_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_reaction_notification_sources FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.member_reaction_notice_is_eligible(p_notification_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.member_reaction_notification_sources s
  JOIN public.app_notifications n ON n.id=s.notification_id
  JOIN public.messages m ON m.id=s.message_id
  JOIN public.message_reactions r ON r.id=s.reaction_id AND r.message_id=s.message_id
   AND r.user_id=s.reactor_id AND r.reaction=s.reaction_value AND r.created_at=s.reaction_created_at
  WHERE s.notification_id=p_notification_id
   AND n.user_id=m.user_id AND n.actor_user_id=s.reactor_id AND m.user_id<>s.reactor_id
   AND n.event_id IS NOT DISTINCT FROM m.event_id AND n.circle_id IS NOT DISTINCT FROM m.circle_id
   AND CASE WHEN m.circle_id IS NOT NULL THEN public.is_circle_member(m.circle_id,s.reactor_id)
    ELSE EXISTS (SELECT 1 FROM public.event_members em WHERE em.event_id=m.event_id
     AND em.user_id=s.reactor_id AND em.status='joined') END
 );
$$;
REVOKE ALL ON FUNCTION public.member_reaction_notice_is_eligible(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.retire_member_reaction_notices() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_notices uuid[];
BEGIN
 IF TG_OP='UPDATE' AND NEW.reaction IS NOT DISTINCT FROM OLD.reaction THEN RETURN NEW; END IF;
 SELECT array_agg(s.notification_id ORDER BY s.notification_id) INTO v_notices
 FROM public.member_reaction_notification_sources s
 WHERE s.reaction_id=OLD.id AND s.reaction_value=OLD.reaction AND s.reaction_created_at=OLD.created_at;
 -- Both retirement and dispatch acquire notification locks in ID order.
 -- Neither path locks reaction rows while holding notification locks.
 PERFORM 1 FROM public.app_notifications n WHERE n.id=ANY(v_notices) ORDER BY n.id FOR UPDATE;
 UPDATE public.app_notifications SET push_suppressed=true WHERE id=ANY(v_notices) AND NOT coalesce(push_suppressed,false);
 RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION public.retire_member_reaction_notices() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retire_member_reaction_notice AFTER UPDATE OR DELETE ON public.message_reactions
 FOR EACH ROW EXECUTE FUNCTION public.retire_member_reaction_notices();

CREATE OR REPLACE FUNCTION public.get_member_chat_push_targets(p_notification_ids uuid[])
RETURNS TABLE(notification_id uuid, user_id uuid, event_id uuid, circle_id uuid, eligible boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_notification_ids IS NULL OR cardinality(p_notification_ids) > 100
    OR cardinality(p_notification_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_notification_ids) ids(id)) THEN
    RAISE EXCEPTION 'Expected at most 100 distinct notification IDs' USING ERRCODE = '22023';
  END IF;

  -- Serialize against a committed removal before evaluating its current source.
  PERFORM 1 FROM public.app_notifications n WHERE n.id=ANY(p_notification_ids)
    ORDER BY n.id FOR UPDATE;

  RETURN QUERY
  WITH decisions AS MATERIALIZED (
    SELECT n.id, n.user_id, n.event_id, n.circle_id,
      (n.status = 'unread' AND NOT coalesce(n.push_suppressed, false)
       AND n.created_at > now() - interval '72 hours'
       AND (n.expires_at IS NULL OR n.expires_at > now())
       AND ((n.event_id IS NULL) <> (n.circle_id IS NULL))
       AND CASE WHEN n.circle_id IS NOT NULL
         THEN public.is_circle_member(n.circle_id, n.user_id)
         ELSE EXISTS (SELECT 1 FROM public.event_members em
           WHERE em.event_id = n.event_id AND em.user_id = n.user_id AND em.status = 'joined')
       END
       AND (n.actor_user_id IS NULL OR NOT public.yours_is_blocked_between(n.user_id, n.actor_user_id))
       AND (NOT EXISTS (SELECT 1 FROM public.member_reaction_notification_sources s WHERE s.notification_id=n.id)
         OR public.member_reaction_notice_is_eligible(n.id))
       AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = n.user_id
         AND n.event_id IS NOT NULL AND p.active_chat_event_id = n.event_id)
      ) AS allowed
    FROM public.app_notifications n
    WHERE n.id = ANY(p_notification_ids) AND n.type = 'new_message'
      AND n.topic_id IS NULL AND (n.event_id IS NOT NULL OR n.circle_id IS NOT NULL)
  ), suppressed AS (
    UPDATE public.app_notifications n SET push_suppressed = true
    FROM decisions d WHERE n.id = d.id AND NOT d.allowed AND NOT coalesce(n.push_suppressed, false)
    RETURNING n.id
  )
  SELECT d.id, d.user_id, d.event_id, d.circle_id, d.allowed FROM decisions d;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_member_chat_push_targets(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_chat_push_targets(uuid[]) TO service_role;

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
  v_notice uuid;
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

  -- Retried writes and a switch back to an already-notified value are silent.
  -- The previous notification remains suppressed after reaction removal/change.
  IF EXISTS (SELECT 1 FROM public.member_reaction_notification_sources s
    WHERE s.reaction_id=NEW.id AND s.reaction_value=NEW.reaction AND s.reaction_created_at=NEW.created_at) THEN
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

  INSERT INTO app_notifications (user_id, type, title, body, event_id, circle_id, actor_user_id)
  VALUES (
    v_msg_author,
    'new_message',
    COALESCE(v_reactor_name, 'Someone') || ' reacted ' || v_emoji_display,
    v_body,
    v_event_id,
    v_circle_id,
    NEW.user_id
  ) RETURNING id INTO v_notice;

  INSERT INTO public.member_reaction_notification_sources(notification_id,reaction_id,message_id,reactor_id,reaction_value,reaction_created_at)
  VALUES(v_notice,NEW.id,NEW.message_id,NEW.user_id,NEW.reaction,NEW.created_at);

  RETURN NEW;
END;
$function$;

COMMIT;
