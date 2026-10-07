-- Pair with the existing push worker's invitation decision reader. Local candidate only.
-- Suppression is terminal; a paused sender holds eligible invitations for later checking.
BEGIN;
ALTER TABLE public.event_invitation_notifications ADD COLUMN suppressed_at timestamptz;

CREATE FUNCTION public.event_invitation_recipient_is_current(p_invitation_id uuid,p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT
  e.status='Live' AND coalesce(e.end_time,e.start_time,(e.event_date+1)::timestamp AT TIME ZONE e.timezone)>now()
  AND public.creator_event_page_id(e.id)=i.page_id
  AND public.is_ticketing_organizer(e.id,i.creator_user_id)
  AND (p.owner_id=i.creator_user_id OR (p.page_kind='community' AND public.is_community_leader(p.page_id,i.creator_user_id)))
  AND i.creator_user_id<>p_user_id AND NOT public.yours_is_blocked_between(i.creator_user_id,p_user_id)
  AND public.creator_page_audience_matches(p.audience,p_user_id)
  AND NOT EXISTS(SELECT FROM public.ticket_orders o WHERE o.event_id=e.id AND o.buyer_user_id=p_user_id AND o.status='paid')
  AND NOT EXISTS(SELECT FROM public.explore_event_rsvps r WHERE r.explore_event_id=e.id AND r.user_id=p_user_id AND r.status='going')
  AND NOT EXISTS(SELECT FROM public.attendee_message_opt_outs o WHERE o.event_id=e.id AND o.user_id=p_user_id)
  AND NOT EXISTS(SELECT FROM public.community_members m WHERE m.community_id=p.page_id AND m.user_id=p_user_id AND m.broadcasts_muted)
  AND CASE i.audience
   WHEN 'followers' THEN p.page_kind='organization' AND EXISTS(SELECT FROM public.creator_page_follow_states f WHERE f.page_id=p.page_id AND f.user_id=p_user_id AND f.following)
   WHEN 'community_members' THEN p.page_kind='community' AND EXISTS(SELECT FROM public.community_members m WHERE m.community_id=p.page_id AND m.user_id=p_user_id AND m.status='active')
   WHEN 'past_attendees' THEN EXISTS(
    SELECT FROM public.explore_events past WHERE past.id<>e.id AND public.creator_event_page_id(past.id)=p.page_id
    AND past.status IN ('Live','Completed') AND coalesce(past.end_time,past.start_time,(past.event_date+1)::timestamp AT TIME ZONE past.timezone)<now()
    AND (EXISTS(SELECT FROM public.ticket_orders o WHERE o.event_id=past.id AND o.buyer_user_id=p_user_id AND o.status='paid')
     OR EXISTS(SELECT FROM public.explore_event_rsvps r WHERE r.explore_event_id=past.id AND r.user_id=p_user_id AND r.status='going')))
   ELSE false END
 FROM public.event_invitation_sends i JOIN public.explore_events e ON e.id=i.event_id
 JOIN public.creator_page_publications p ON p.page_id=i.page_id
 WHERE i.id=p_invitation_id),false);
$$;

CREATE FUNCTION public.get_event_invitation_push_decisions(p_notification_ids uuid[])
RETURNS TABLE(notification_id uuid,user_id uuid,decision text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Invitation dispatch access denied' USING ERRCODE='42501'; END IF;
 IF p_notification_ids IS NULL OR cardinality(p_notification_ids)>1000 OR array_position(p_notification_ids,NULL) IS NOT NULL
 OR cardinality(p_notification_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_notification_ids)x) THEN RAISE EXCEPTION 'Invalid invitation notification batch'; END IF;
 -- Keep prior in-app text/history. Only future push is suppressed.
 UPDATE public.event_invitation_notifications link SET suppressed_at=coalesce(link.suppressed_at,now())
 FROM public.app_notifications n
 WHERE link.notification_id=n.id AND n.id=ANY(p_notification_ids) AND (
  n.user_id<>link.user_id OR n.type<>'broadcast' OR n.event_id IS NOT NULL
  OR n.push_suppressed OR n.status<>'unread' OR (n.expires_at IS NOT NULL AND n.expires_at<=now())
  OR NOT EXISTS(SELECT FROM public.event_invitation_sends i WHERE i.id=link.invitation_id AND i.event_id=n.explore_event_origin_id AND i.event_id=n.explore_event_id)
  OR NOT public.event_invitation_recipient_is_current(link.invitation_id,link.user_id)
 );
 UPDATE public.app_notifications n SET push_suppressed=true
 FROM public.event_invitation_notifications link
 WHERE link.notification_id=n.id AND n.id=ANY(p_notification_ids) AND link.suppressed_at IS NOT NULL;
 RETURN QUERY SELECT n.id,n.user_id,
 CASE WHEN link.notification_id IS NULL THEN 'ordinary'
      WHEN link.suppressed_at IS NOT NULL THEN 'suppress'
      WHEN NOT coalesce((SELECT enabled FROM public.event_invitation_policy WHERE singleton),false) THEN 'hold'
      ELSE 'send' END
 FROM public.app_notifications n LEFT JOIN public.event_invitation_notifications link ON link.notification_id=n.id
 WHERE n.id=ANY(p_notification_ids) AND n.type='broadcast' AND n.event_id IS NULL AND n.explore_event_origin_id IS NOT NULL;
END$$;
REVOKE ALL ON FUNCTION public.event_invitation_recipient_is_current(uuid,uuid),public.get_event_invitation_push_decisions(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_event_invitation_push_decisions(uuid[]) TO service_role;
COMMENT ON FUNCTION public.get_event_invitation_push_decisions(uuid[]) IS 'Service-only immediate pre-provider check. Ordinary attendee updates remain ordinary; changed invitation eligibility suppresses permanently; disabled policy holds without erasing in-app text.';
COMMIT;
