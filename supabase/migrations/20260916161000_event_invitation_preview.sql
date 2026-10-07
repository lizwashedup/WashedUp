-- Isolated candidate: page-scoped invitation preview only. No send or provider operation.
BEGIN;
CREATE FUNCTION public.preview_event_invitation(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events; p public.creator_page_publications; audience text;
 candidate_count integer; excluded_count integer; eligible_count integer; options jsonb:='[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to prepare an invitation.' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id;
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=public.creator_event_page_id(p_event_id);
 -- A person creating an event does not inherit the page's follower/member audience.
 IF e.id IS NULL OR p.page_id IS NULL OR NOT coalesce(public.is_ticketing_organizer(e.id,auth.uid()),false)
 OR NOT coalesce(p.owner_id=auth.uid() OR (p.page_kind='community' AND public.is_community_leader(p.page_id,auth.uid())),false) THEN
  RAISE EXCEPTION 'This page’s invitation audience is unavailable for this account.' USING ERRCODE='42501';
 END IF;
 FOREACH audience IN ARRAY ARRAY['past_attendees',CASE WHEN p.page_kind='organization' THEN 'followers' ELSE 'community_members' END] LOOP
  WITH past_events AS (
   SELECT x.id FROM public.explore_events x WHERE x.id<>e.id
    AND public.creator_event_page_id(x.id)=p.page_id AND x.status='Live'
    AND coalesce(x.end_time,x.start_time,(x.event_date+1)::timestamp AT TIME ZONE x.timezone)<now()
  ), candidates AS (
   SELECT o.buyer_user_id AS user_id FROM public.ticket_orders o JOIN past_events x ON x.id=o.event_id
    WHERE audience='past_attendees' AND o.status='paid' AND o.buyer_user_id IS NOT NULL
   UNION SELECT r.user_id FROM public.explore_event_rsvps r JOIN past_events x ON x.id=r.explore_event_id
    WHERE audience='past_attendees' AND r.status='going'
   UNION SELECT f.user_id FROM public.creator_page_follow_states f
    WHERE audience='followers' AND f.page_id=p.page_id AND f.following
   UNION SELECT m.user_id FROM public.community_members m
    WHERE audience='community_members' AND m.community_id=p.page_id AND m.status='active'
  ), checked AS (
   SELECT c.user_id,
    EXISTS(SELECT FROM public.ticket_orders o WHERE o.event_id=e.id AND o.buyer_user_id=c.user_id AND o.status='paid')
    OR EXISTS(SELECT FROM public.explore_event_rsvps r WHERE r.explore_event_id=e.id AND r.user_id=c.user_id AND r.status='going') AS already_going,
    c.user_id=auth.uid() OR public.yours_is_blocked_between(auth.uid(),c.user_id)
    OR NOT coalesce(public.creator_page_audience_matches(p.audience,c.user_id),false)
    OR EXISTS(SELECT FROM public.attendee_message_opt_outs o WHERE o.event_id=e.id AND o.user_id=c.user_id) AS excluded
   FROM candidates c
  ) SELECT count(*),count(*) FILTER(WHERE already_going OR excluded),count(*) FILTER(WHERE NOT already_going AND NOT excluded)
    INTO candidate_count,excluded_count,eligible_count FROM checked;
  options:=options||jsonb_build_array(jsonb_build_object('type',audience,'sourceCount',candidate_count,'excludedCount',excluded_count,'eligibleCount',eligible_count));
 END LOOP;
 RETURN jsonb_build_object('eventId',e.id,'eventTitle',e.title,'eventImage',e.image_url,'eventStatus',e.status,
  'pageId',p.page_id,'pageName',p.name,'pageKind',p.page_kind,'audiences',options,'deliveryReady',false);
END $$;
REVOKE ALL ON FUNCTION public.preview_event_invitation(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_event_invitation(uuid) TO authenticated;
COMMENT ON FUNCTION public.preview_event_invitation(uuid) IS 'Read-only distinct page audience counts; excludes current registrants. Does not expose identities, assert channel consent, schedule or send.';
COMMIT;
