-- REVIEW ONLY. Independent member-owned whole-community notification override.
-- Requires verified source capture and coordinated worker recipient checks.
-- Activate only after ambiguous legacy queues have drained; never infer sources.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.community_topic_notice_recipient_allowed(uuid,uuid,uuid)'::regprocedure))<>'eaf9e900e1f1e6ffc0fa5fb6e01eaf18' THEN RAISE EXCEPTION 'Unexpected community_topic_notice_recipient_allowed(uuid,uuid,uuid) definition'; END IF;
 IF md5(pg_get_functiondef('public.community_announcement_recipient_allowed(uuid,uuid,uuid)'::regprocedure))<>'3ef8b5397a707dbd30b67f98eaa3d1f8' THEN RAISE EXCEPTION 'Unexpected community_announcement_recipient_allowed(uuid,uuid,uuid) definition'; END IF;
 IF md5(pg_get_functiondef('public.community_chat_sources_required()'::regprocedure))<>'40a30fc74d5096e093ff59b424a8f1e8' THEN RAISE EXCEPTION 'Unexpected community_chat_sources_required() definition'; END IF;
 IF md5(pg_get_functiondef('public.is_community_member(uuid,uuid)'::regprocedure))<>'d785b394b25bf7ebb0eabdd3ab8a2108' THEN RAISE EXCEPTION 'Unexpected is_community_member(uuid,uuid) definition'; END IF;
END $guard$;
CREATE FUNCTION public.community_chat_source_transition_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 -- The older claim has no age cutoff. Guard every unsent unread legacy row,
 -- plus claimed rows in the current worker's 72-hour delivery horizon.
 SELECT NOT EXISTS(SELECT 1 FROM public.app_notifications n
  WHERE n.type='community_broadcast' AND n.status='unread' AND NOT n.push_suppressed
   AND (NOT n.push_sent OR n.created_at>now()-interval '72 hours')
   AND NOT EXISTS(SELECT 1 FROM public.community_chat_notification_targets t WHERE t.notification_id=n.id));
$$;
REVOKE ALL ON FUNCTION public.community_chat_source_transition_ready() FROM PUBLIC,anon,authenticated,service_role;
-- Serializes this transition against announcement inserts/claims. No queue
-- deletion or suppression is used to force readiness.
LOCK TABLE public.app_notifications IN SHARE ROW EXCLUSIVE MODE;
DO $transition$ BEGIN
 IF NOT public.community_chat_source_transition_ready() THEN
  RAISE EXCEPTION 'Legacy community announcements still require delivery reconciliation; retain capture phase' USING ERRCODE='55000';
 END IF;
END $transition$;
CREATE OR REPLACE FUNCTION public.community_chat_sources_required() RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT true $$;

CREATE TABLE public.community_chat_preferences (
 community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 muted boolean NOT NULL DEFAULT false,
 version integer NOT NULL CHECK(version>0),
 PRIMARY KEY(community_id,user_id)
);
ALTER TABLE public.community_chat_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_chat_preferences FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.community_all_chats_muted(p_community_id uuid,p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT muted FROM public.community_chat_preferences WHERE community_id=p_community_id AND user_id=p_user_id),false);
$$;
REVOKE ALL ON FUNCTION public.community_all_chats_muted(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_community_chat_preference(p_community_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE preference public.community_chat_preferences;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_community_member(p_community_id,auth.uid()) THEN
  RAISE EXCEPTION 'Join this community to manage its chat notifications' USING ERRCODE='42501'; END IF;
 SELECT * INTO preference FROM public.community_chat_preferences WHERE community_id=p_community_id AND user_id=auth.uid();
 RETURN jsonb_build_object('community_id',p_community_id,'user_id',auth.uid(),'muted',coalesce(preference.muted,false),'version',coalesce(preference.version,0));
END $$;
CREATE FUNCTION public.set_community_chat_preference(p_community_id uuid,p_muted boolean,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE preference public.community_chat_preferences; notice_ids uuid[];
BEGIN
 IF p_muted IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN
  RAISE EXCEPTION 'A confirmed notification setting is required' USING ERRCODE='22023'; END IF;
 -- Preserve one serialization order with existing page/member management.
 PERFORM 1 FROM public.communities WHERE id=p_community_id FOR SHARE;
 PERFORM 1 FROM public.community_members WHERE community_id=p_community_id AND user_id=auth.uid() FOR UPDATE;
 IF auth.uid() IS NULL OR NOT public.is_community_member(p_community_id,auth.uid()) THEN
  RAISE EXCEPTION 'Join this community to manage its chat notifications' USING ERRCODE='42501'; END IF;
 SELECT * INTO preference FROM public.community_chat_preferences WHERE community_id=p_community_id AND user_id=auth.uid() FOR UPDATE;
 IF coalesce(preference.version,0)<>p_expected_version THEN
  RAISE EXCEPTION 'Your notification setting changed. Check it before saving.' USING ERRCODE='PT409'; END IF;
 IF coalesce(preference.muted,false) IS DISTINCT FROM p_muted THEN
  INSERT INTO public.community_chat_preferences(community_id,user_id,muted,version)
  VALUES(p_community_id,auth.uid(),p_muted,p_expected_version+1)
  ON CONFLICT(community_id,user_id) DO UPDATE SET muted=EXCLUDED.muted,version=EXCLUDED.version;
 END IF;
 IF p_muted THEN
  -- Permanently suppress already queued/claimed notices for persistent rooms.
  -- Event-attendee chats keep their independent preference and expiry rules.
  SELECT array_agg(t.notification_id ORDER BY t.notification_id) INTO notice_ids
  FROM public.community_chat_notification_targets t JOIN public.app_notifications n ON n.id=t.notification_id
  WHERE t.community_id=p_community_id AND t.user_id=auth.uid() AND n.status='unread'
   AND (t.source_kind='broadcast' OR EXISTS(SELECT 1 FROM public.community_topics room WHERE room.id=t.topic_id AND room.community_id=t.community_id AND room.original_event_id IS NULL AND room.explore_event_id IS NULL));
  IF notice_ids IS NOT NULL THEN PERFORM 1 FROM public.get_community_chat_push_targets(notice_ids); END IF;
 END IF;
 RETURN public.get_community_chat_preference(p_community_id);
END $$;
REVOKE ALL ON FUNCTION public.get_community_chat_preference(uuid),public.set_community_chat_preference(uuid,boolean,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_community_chat_preference(uuid),public.set_community_chat_preference(uuid,boolean,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.community_topic_notice_recipient_allowed(p_topic_id uuid, p_user_id uuid, p_sender_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p_user_id IS NOT NULL AND p_sender_id IS NOT NULL AND p_user_id<>p_sender_id
 AND NOT public.yours_is_blocked_between(p_user_id,p_sender_id)
 AND EXISTS(
  SELECT 1 FROM public.community_topics t
  JOIN public.community_topic_members tm ON tm.topic_id=t.id AND tm.user_id=p_user_id AND tm.notifications_on
  JOIN public.communities c ON c.id=t.community_id
  LEFT JOIN public.creator_page_publications pub ON pub.page_id=c.id
  WHERE t.id=p_topic_id AND NOT t.archived
   AND (NOT EXISTS(SELECT 1 FROM public.creator_page_drafts WHERE id=c.id)
        AND pub.page_id IS NULL
        OR pub.page_id IS NOT NULL AND c.status='active' AND public.creator_page_audience_matches(pub.audience,p_user_id))
   AND CASE WHEN t.original_event_id IS NULL AND t.explore_event_id IS NULL THEN
    c.status='active' AND NOT public.community_all_chats_muted(c.id,p_user_id) AND EXISTS(SELECT 1 FROM public.community_members cm WHERE cm.community_id=c.id AND cm.user_id=p_user_id AND cm.status='active')
   ELSE
    -- Keep attendance-owned topic membership; never require community joining.
    -- A removed source event cannot turn into a persistent group or send notices.
    EXISTS(SELECT 1 FROM public.explore_events e WHERE e.id=t.explore_event_id AND e.status='Live'
     AND (coalesce(e.end_time,e.start_time,e.event_date::timestamptz) IS NULL
          OR now()<coalesce(e.end_time,e.start_time,e.event_date::timestamptz)+interval '48 hours'))
   END
 );
$function$
;
CREATE OR REPLACE FUNCTION public.community_announcement_recipient_allowed(p_community_id uuid, p_user_id uuid, p_sender_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT p_user_id IS NOT NULL AND p_sender_id IS NOT NULL AND p_user_id<>p_sender_id
 AND NOT public.yours_is_blocked_between(p_user_id,p_sender_id)
 AND NOT public.community_all_chats_muted(p_community_id,p_user_id)
 AND EXISTS(SELECT 1 FROM public.communities c
  JOIN public.community_members m ON m.community_id=c.id AND m.user_id=p_user_id AND m.status='active' AND NOT m.broadcasts_muted
  LEFT JOIN public.creator_page_publications p ON p.page_id=c.id
  WHERE c.id=p_community_id AND c.status='active'
   AND (p.page_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.creator_page_drafts WHERE id=c.id)
     OR p.page_id IS NOT NULL AND public.creator_page_audience_matches(p.audience,p_user_id)));
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
