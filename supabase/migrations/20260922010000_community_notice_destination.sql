-- Resolve only the signed-in recipient's existing in-app community notice.
-- Muting delivery does not prevent an intentional tap into a permitted chat.
BEGIN;
CREATE FUNCTION public.get_my_community_notice_target(p_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid:=auth.uid(); n public.app_notifications;
 t public.community_chat_notification_targets; b public.community_broadcasts;
 s public.community_reaction_notification_sources; v_topic uuid; v_reaction boolean;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to open this conversation' USING ERRCODE='42501'; END IF;
 SELECT * INTO n FROM public.app_notifications WHERE id=p_notification_id AND user_id=v_user AND type='community_broadcast';
 IF NOT FOUND OR n.expires_at IS NOT NULL AND n.expires_at<=now() THEN RETURN NULL; END IF;
 SELECT * INTO t FROM public.community_chat_notification_targets WHERE notification_id=n.id AND user_id=v_user AND source_kind='broadcast';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO b FROM public.community_broadcasts WHERE id=t.broadcast_id AND community_id=t.community_id;
 IF NOT FOUND OR NOT public.is_community_member(b.community_id,v_user)
  OR NOT public.creator_community_is_visible(b.community_id)
  OR public.yours_is_blocked_between(v_user,t.sender_id) THEN RETURN NULL; END IF;
 IF b.kind='intro' THEN
  SELECT intro_topic_id INTO v_topic FROM public.community_chat_layouts WHERE community_id=b.community_id;
  IF v_topic IS NOT NULL AND (NOT public.is_topic_member(v_topic,v_user) OR NOT public.creator_topic_is_visible(v_topic)) THEN RETURN NULL; END IF;
 END IF;
 SELECT * INTO s FROM public.community_reaction_notification_sources WHERE notification_id=n.id;
 v_reaction:=FOUND;
 IF v_reaction THEN
  IF s.source_kind<>'broadcast' OR s.source_id<>b.id OR s.reactor_id IS DISTINCT FROM t.sender_id
   OR n.actor_user_id IS DISTINCT FROM s.reactor_id OR b.sender_id IS DISTINCT FROM v_user
   OR s.destination_topic_id IS DISTINCT FROM v_topic
   OR NOT EXISTS(SELECT 1 FROM public.community_members cm WHERE cm.community_id=b.community_id AND cm.user_id=s.reactor_id AND cm.status='active')
   OR v_topic IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.community_topic_members tm WHERE tm.topic_id=v_topic AND tm.user_id=s.reactor_id)
   OR NOT EXISTS(SELECT 1 FROM public.community_broadcast_reactions r WHERE r.broadcast_id=b.id
     AND r.user_id=s.reactor_id AND r.emoji=s.reaction_value AND r.created_at=s.reaction_created_at) THEN RETURN NULL; END IF;
 ELSIF b.sender_id IS DISTINCT FROM t.sender_id THEN RETURN NULL;
 END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('notificationId',n.id,'type',n.type,'communityId',b.community_id,
  'communityBroadcastId',b.id,'topicId',v_topic,'reactionMessageId',CASE WHEN v_reaction THEN b.id END,
  'reactionMessageSource',CASE WHEN v_reaction THEN 'broadcast' END));
END $$;
REVOKE ALL ON FUNCTION public.get_my_community_notice_target(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_community_notice_target(uuid) TO authenticated;
COMMIT;
