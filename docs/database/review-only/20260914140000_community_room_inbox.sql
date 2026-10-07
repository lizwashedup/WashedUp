-- REVIEW ONLY. Mapped-room inbox summaries; original storage and old readers stay intact.
-- Requires local-verified room identity, introduction routing, core reads and topic locations.
BEGIN;
CREATE FUNCTION public.get_my_community_room_summaries() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_community record; v_layout jsonb; v_room jsonb; v_rooms jsonb; v_latest jsonb;
 v_unread bigint; v_read timestamptz; v_joined timestamptz; v_events jsonb; v_result jsonb='[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to open your chats' USING ERRCODE='42501'; END IF;
 FOR v_community IN
  SELECT c.id,m.joined_at FROM public.community_chat_layouts l
  JOIN public.communities c ON c.id=l.community_id
  JOIN public.community_members m ON m.community_id=c.id AND m.user_id=auth.uid() AND m.status='active'
  ORDER BY c.id
 LOOP
  v_layout=public.get_community_room_identities(v_community.id);
  IF v_layout IS NULL OR jsonb_array_length(v_layout->'rooms')<2 OR v_layout->'rooms'->0->>'role'<>'intros'
   OR v_layout->'rooms'->1->>'role'<>'main' THEN
   RAISE EXCEPTION 'Community room identity could not be confirmed' USING ERRCODE='42501';
  END IF;
  v_rooms='[]'::jsonb;
  FOR v_room IN SELECT value FROM jsonb_array_elements(v_layout->'rooms') WITH ORDINALITY WHERE value->>'joined'='true' ORDER BY ordinality LOOP
   v_latest=NULL; v_read=NULL; v_joined=NULL;
   IF v_room->>'role' IN ('intros','main') THEN
    v_unread=(public.get_community_core_read_state(v_community.id,v_room->>'role')->>'unread')::bigint;
   ELSE
    SELECT last_read_at INTO v_read FROM public.community_topic_reads WHERE topic_id=(v_room->>'id')::uuid AND user_id=auth.uid();
    SELECT count(*) INTO v_unread FROM public.community_topic_messages m WHERE m.topic_id=(v_room->>'id')::uuid
     AND m.sender_id IS DISTINCT FROM auth.uid() AND (m.sender_id IS NULL OR NOT public.yours_is_blocked_between(auth.uid(),m.sender_id))
     AND (v_read IS NULL OR m.created_at>v_read);
   END IF;
   IF v_room->>'role'='main' THEN
    v_joined=v_community.joined_at;
   ELSE
    SELECT joined_at INTO v_joined FROM public.community_topic_members WHERE topic_id=(v_room->>'id')::uuid AND user_id=auth.uid();
   END IF;
   SELECT jsonb_build_object('id',q.id,'source',q.source,'body',q.body,'created_at',q.created_at,'has_image',q.has_image,'has_location',q.has_location)
    INTO v_latest FROM (
    SELECT b.id,'broadcast'::text source,b.body,b.created_at,(nullif(b.image_url,'') IS NOT NULL) has_image,false has_location
     FROM public.community_broadcasts b WHERE b.community_id=v_community.id
     AND ((v_room->>'role'='intros' AND b.kind='intro') OR (v_room->>'role'='main' AND b.kind<>'intro'))
     AND (b.sender_id IS NULL OR NOT public.yours_is_blocked_between(auth.uid(),b.sender_id))
    UNION ALL
    SELECT m.id,'topic'::text,m.body,m.created_at,(nullif(m.image_url,'') IS NOT NULL),(m.location_lat IS NOT NULL AND m.location_lng IS NOT NULL)
     FROM public.community_topic_messages m WHERE v_room->>'role'<>'main' AND m.topic_id=(v_room->>'id')::uuid
     AND (m.sender_id IS NULL OR NOT public.yours_is_blocked_between(auth.uid(),m.sender_id))
   ) q ORDER BY q.created_at DESC,q.source DESC,q.id DESC LIMIT 1;
   v_rooms=v_rooms||jsonb_build_array(v_room||jsonb_build_object('unread',v_unread,'latest',v_latest,'joined_at',v_joined));
  END LOOP;
  -- Original event provenance is retained even after its event FK is cleared.
  -- These are metadata for existing event rows, never persistent-room children.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'event_id',t.original_event_id) ORDER BY t.id),'[]'::jsonb)
   INTO v_events FROM public.community_topics t JOIN public.community_topic_members m ON m.topic_id=t.id AND m.user_id=auth.uid()
   WHERE t.community_id=v_community.id AND t.original_event_id IS NOT NULL;
  v_result=v_result||jsonb_build_array(jsonb_build_object('community_id',v_community.id,'name',v_layout->>'name','rooms',v_rooms,'event_topics',v_events));
 END LOOP;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_my_community_room_summaries() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_community_room_summaries() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
