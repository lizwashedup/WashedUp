-- Author-only community reaction alerts using existing room preferences/dispatch.
BEGIN;
CREATE TABLE public.community_reaction_notification_sources (
 notification_id uuid PRIMARY KEY REFERENCES public.app_notifications(id) ON DELETE CASCADE,
 source_kind text NOT NULL CHECK(source_kind IN ('topic','broadcast')),
 source_id uuid NOT NULL,
 reactor_id uuid NOT NULL,
 reaction_value text NOT NULL,
 reaction_created_at timestamptz NOT NULL,
 destination_topic_id uuid,
 UNIQUE(source_kind,source_id,reactor_id,reaction_value,reaction_created_at)
);
ALTER TABLE public.community_reaction_notification_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_reaction_notification_sources FROM PUBLIC,anon,authenticated,service_role;

-- This returns a context only while BOTH people can access the original content
-- and the author has its existing room notification preference enabled.
CREATE FUNCTION public.community_reaction_context(p_kind text,p_source_id uuid,p_reactor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_author uuid; v_community uuid; v_topic uuid; v_destination uuid; v_kind text;
BEGIN
 IF p_kind='topic' THEN
  SELECT m.sender_id,t.community_id,t.id INTO v_author,v_community,v_topic
   FROM public.community_topic_messages m JOIN public.community_topics t ON t.id=m.topic_id WHERE m.id=p_source_id;
  v_destination:=v_topic;
 ELSIF p_kind='broadcast' THEN
  SELECT b.sender_id,b.community_id,b.kind INTO v_author,v_community,v_kind
   FROM public.community_broadcasts b WHERE b.id=p_source_id;
  IF v_kind='intro' THEN
   SELECT l.intro_topic_id INTO v_destination FROM public.community_chat_layouts l WHERE l.community_id=v_community;
  END IF;
 ELSE RETURN NULL; END IF;
 IF v_author IS NULL OR p_reactor IS NULL OR v_author=p_reactor THEN RETURN NULL; END IF;
 -- Existing publication/audience decisions must apply to the reactor too.
 IF NOT EXISTS(SELECT 1 FROM public.communities c LEFT JOIN public.creator_page_publications pub ON pub.page_id=c.id
  WHERE c.id=v_community AND (pub.page_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.creator_page_drafts WHERE id=c.id)
   OR pub.page_id IS NOT NULL AND c.status='active' AND public.creator_page_audience_matches(pub.audience,p_reactor))) THEN RETURN NULL; END IF;
 IF v_destination IS NOT NULL THEN
  IF NOT public.community_topic_notice_recipient_allowed(v_destination,v_author,p_reactor)
   OR NOT EXISTS(SELECT 1 FROM public.community_topic_members tm WHERE tm.topic_id=v_destination AND tm.user_id=p_reactor)
   OR EXISTS(SELECT 1 FROM public.community_topics t WHERE t.id=v_destination AND t.explore_event_id IS NULL AND t.original_event_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.community_members cm WHERE cm.community_id=v_community AND cm.user_id=p_reactor AND cm.status='active'))
   THEN RETURN NULL; END IF;
 ELSE
  IF NOT public.community_announcement_recipient_allowed(v_community,v_author,p_reactor)
   OR NOT EXISTS(SELECT 1 FROM public.community_members cm WHERE cm.community_id=v_community AND cm.user_id=p_reactor AND cm.status='active')
   THEN RETURN NULL; END IF;
 END IF;
 RETURN jsonb_build_object('user_id',v_author,'community_id',v_community,'topic_id',v_topic,'destination_topic_id',v_destination);
END $$;
REVOKE ALL ON FUNCTION public.community_reaction_context(text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.community_reaction_notice_is_eligible(p_notification_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.community_reaction_notification_sources; t public.community_chat_notification_targets; n public.app_notifications; context jsonb;
BEGIN
 SELECT * INTO s FROM public.community_reaction_notification_sources WHERE notification_id=p_notification_id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO t FROM public.community_chat_notification_targets WHERE notification_id=p_notification_id;
 SELECT * INTO n FROM public.app_notifications WHERE id=p_notification_id;
 context:=public.community_reaction_context(s.source_kind,s.source_id,s.reactor_id);
 IF context IS NULL OR t.source_kind IS DISTINCT FROM s.source_kind OR t.sender_id IS DISTINCT FROM s.reactor_id
  OR t.user_id IS DISTINCT FROM (context->>'user_id')::uuid OR t.community_id IS DISTINCT FROM (context->>'community_id')::uuid
  OR n.user_id IS DISTINCT FROM t.user_id OR n.actor_user_id IS DISTINCT FROM s.reactor_id
  OR t.suppressed_at IS NOT NULL OR n.push_suppressed OR n.status<>'unread' OR n.created_at<=now()-interval '72 hours'
  OR n.expires_at IS NOT NULL AND n.expires_at<=now() OR n.event_id IS NOT NULL OR n.circle_id IS NOT NULL
  OR s.destination_topic_id IS DISTINCT FROM (context->>'destination_topic_id')::uuid THEN RETURN false; END IF;
 IF s.source_kind='topic' THEN
  RETURN n.type='new_message' AND n.topic_id IS NOT DISTINCT FROM t.topic_id AND t.topic_id=(context->>'topic_id')::uuid
   AND EXISTS(SELECT 1 FROM public.community_topic_message_reactions r WHERE r.message_id=s.source_id AND r.user_id=s.reactor_id
    AND r.reaction=s.reaction_value AND r.created_at=s.reaction_created_at);
 END IF;
 RETURN n.type='community_broadcast' AND n.topic_id IS NULL AND t.broadcast_id=s.source_id
  AND EXISTS(SELECT 1 FROM public.community_broadcast_reactions r WHERE r.broadcast_id=s.source_id AND r.user_id=s.reactor_id
   AND r.emoji=s.reaction_value AND r.created_at=s.reaction_created_at);
END $$;
REVOKE ALL ON FUNCTION public.community_reaction_notice_is_eligible(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.notify_community_reaction_author() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_source text; v_id uuid; v_reaction text; context jsonb; v_name text; v_body text; v_image text; v_notice uuid; v_display text;
BEGIN
 IF TG_TABLE_NAME='community_topic_message_reactions' THEN
  IF TG_OP='UPDATE' AND NEW.reaction IS NOT DISTINCT FROM OLD.reaction THEN RETURN NEW; END IF;
  v_source:='topic'; v_id:=NEW.message_id; v_reaction:=NEW.reaction;
  SELECT body,image_url INTO v_body,v_image FROM public.community_topic_messages WHERE id=v_id;
 ELSE
  v_source:='broadcast';v_id:=NEW.broadcast_id;v_reaction:=NEW.emoji;
  SELECT body,image_url INTO v_body,v_image FROM public.community_broadcasts WHERE id=v_id;
 END IF;
 context:=public.community_reaction_context(v_source,v_id,NEW.user_id);
 IF context IS NULL THEN RETURN NEW; END IF;
 -- Exact write retries and a switch back to an already-notified reaction are
 -- silent. The original source record survives removal; it never reactivates.
 IF EXISTS(SELECT 1 FROM public.community_reaction_notification_sources s WHERE s.source_kind=v_source AND s.source_id=v_id
  AND s.reactor_id=NEW.user_id AND s.reaction_value=v_reaction AND s.reaction_created_at=NEW.created_at) THEN RETURN NEW; END IF;
 SELECT first_name_display INTO v_name FROM public.profiles WHERE id=NEW.user_id;
 v_display:=CASE v_reaction WHEN 'heart' THEN '❤️' WHEN 'thumbsup' THEN '👍' WHEN 'laugh' THEN '😂'
  WHEN 'surprise' THEN '😮' WHEN 'cry' THEN '😢' WHEN 'pray' THEN '🙏' ELSE v_reaction END;
 v_body:=CASE WHEN coalesce(v_body,'')='' THEN CASE WHEN v_image IS NULL THEN 'to your message' ELSE 'to your photo' END
  WHEN length(v_body)>80 THEN left(v_body,77)||'...' ELSE v_body END;
 INSERT INTO public.app_notifications(user_id,type,title,body,actor_user_id,topic_id)
 VALUES((context->>'user_id')::uuid,CASE WHEN v_source='topic' THEN 'new_message' ELSE 'community_broadcast' END,
  coalesce(v_name,'Someone')||' reacted '||v_display,v_body,NEW.user_id,(context->>'topic_id')::uuid) RETURNING id INTO v_notice;
 -- The established topic target trigger captures topic notices automatically.
 IF v_source='broadcast' THEN
  INSERT INTO public.community_chat_notification_targets(notification_id,user_id,source_kind,community_id,broadcast_id,sender_id)
  VALUES(v_notice,(context->>'user_id')::uuid,'broadcast',(context->>'community_id')::uuid,v_id,NEW.user_id);
 END IF;
 INSERT INTO public.community_reaction_notification_sources(notification_id,source_kind,source_id,reactor_id,reaction_value,reaction_created_at,destination_topic_id)
 VALUES(v_notice,v_source,v_id,NEW.user_id,v_reaction,NEW.created_at,(context->>'destination_topic_id')::uuid);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_community_reaction_author() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.retire_community_reaction_notices() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_source text;v_id uuid;v_value text;v_notices uuid[];
BEGIN
 IF TG_TABLE_NAME='community_topic_message_reactions' THEN
  IF TG_OP='UPDATE' AND NEW.reaction IS NOT DISTINCT FROM OLD.reaction THEN RETURN NEW; END IF;
  v_source:='topic';v_id:=OLD.message_id;v_value:=OLD.reaction;
 ELSE
  v_source:='broadcast';v_id:=OLD.broadcast_id;v_value:=OLD.emoji;
 END IF;
 -- Match the existing dispatch lock order: notifications, then targets.
 SELECT array_agg(s.notification_id ORDER BY s.notification_id) INTO v_notices
 FROM public.community_reaction_notification_sources s WHERE s.source_kind=v_source AND s.source_id=v_id
  AND s.reactor_id=OLD.user_id AND s.reaction_value=v_value AND s.reaction_created_at=OLD.created_at;
 PERFORM 1 FROM public.app_notifications n WHERE n.id=ANY(v_notices) ORDER BY n.id FOR UPDATE;
 UPDATE public.community_chat_notification_targets t SET suppressed_at=coalesce(t.suppressed_at,now())
 FROM public.community_reaction_notification_sources s WHERE s.notification_id=t.notification_id
  AND s.source_kind=v_source AND s.source_id=v_id AND s.reactor_id=OLD.user_id
  AND s.reaction_value=v_value AND s.reaction_created_at=OLD.created_at;
 UPDATE public.app_notifications n SET push_suppressed=true
 FROM public.community_reaction_notification_sources s WHERE s.notification_id=n.id
  AND s.source_kind=v_source AND s.source_id=v_id AND s.reactor_id=OLD.user_id
  AND s.reaction_value=v_value AND s.reaction_created_at=OLD.created_at;
 RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION public.retire_community_reaction_notices() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retire_community_topic_reaction_notice AFTER UPDATE OR DELETE ON public.community_topic_message_reactions
 FOR EACH ROW EXECUTE FUNCTION public.retire_community_reaction_notices();
CREATE TRIGGER retire_community_broadcast_reaction_notice AFTER DELETE ON public.community_broadcast_reactions
 FOR EACH ROW EXECUTE FUNCTION public.retire_community_reaction_notices();
CREATE TRIGGER notify_community_topic_reaction_author AFTER INSERT OR UPDATE ON public.community_topic_message_reactions
 FOR EACH ROW EXECUTE FUNCTION public.notify_community_reaction_author();
CREATE TRIGGER notify_community_broadcast_reaction_author AFTER INSERT ON public.community_broadcast_reactions
 FOR EACH ROW EXECUTE FUNCTION public.notify_community_reaction_author();

CREATE OR REPLACE FUNCTION public.community_chat_notice_is_eligible(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE n public.app_notifications; t public.community_chat_notification_targets;
BEGIN
 SELECT * INTO n FROM public.app_notifications WHERE id=p_notification_id;
 IF NOT FOUND OR n.status<>'unread' OR n.push_suppressed OR n.created_at<=now()-interval '72 hours'
  OR n.expires_at IS NOT NULL AND n.expires_at<=now() THEN RETURN false; END IF;
 SELECT * INTO t FROM public.community_chat_notification_targets original WHERE original.notification_id=n.id;
 IF NOT FOUND THEN
  IF n.type='community_broadcast' THEN RETURN NOT public.community_chat_sources_required(); END IF;
  IF n.type='new_message' AND n.topic_id IS NOT NULL THEN
   RETURN public.community_topic_notice_recipient_allowed(n.topic_id,n.user_id,n.actor_user_id);
  END IF;
  RETURN true;
 END IF;
 IF t.suppressed_at IS NOT NULL OR n.user_id IS DISTINCT FROM t.user_id OR n.actor_user_id IS DISTINCT FROM t.sender_id
  OR n.event_id IS NOT NULL OR n.circle_id IS NOT NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.community_reaction_notification_sources r WHERE r.notification_id=n.id) THEN
  RETURN public.community_reaction_notice_is_eligible(n.id);
 END IF;
 IF t.source_kind='topic' THEN
  RETURN n.type='new_message' AND n.topic_id IS NOT DISTINCT FROM t.topic_id
   AND EXISTS(SELECT 1 FROM public.community_topics WHERE id=t.topic_id AND community_id=t.community_id)
   AND public.community_topic_notice_recipient_allowed(t.topic_id,t.user_id,t.sender_id);
 END IF;
 RETURN n.type='community_broadcast' AND n.topic_id IS NULL
  AND EXISTS(SELECT 1 FROM public.community_broadcasts b WHERE b.id=t.broadcast_id AND b.community_id=t.community_id AND b.sender_id=t.sender_id AND b.kind='broadcast')
  AND public.community_announcement_recipient_allowed(t.community_id,t.user_id,t.sender_id);
END $function$
;

-- A new return contract leaves the original RPC/signature intact for older
-- workers and preference updates. Every response still rechecks eligibility.
CREATE FUNCTION public.get_community_chat_push_targets_v2(p_notification_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_notification_ids IS NULL OR cardinality(p_notification_ids)>100
  OR cardinality(p_notification_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_notification_ids) ids(id)) THEN
  RAISE EXCEPTION 'Expected at most 100 distinct notification IDs' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('message_id',s.source_id,'message_source',s.source_kind,'destination_topic_id',s.destination_topic_id)),'[]'::jsonb)
 INTO result FROM public.get_community_chat_push_targets(p_notification_ids) t
 LEFT JOIN public.community_reaction_notification_sources s ON s.notification_id=t.notification_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_community_chat_push_targets_v2(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_community_chat_push_targets_v2(uuid[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
