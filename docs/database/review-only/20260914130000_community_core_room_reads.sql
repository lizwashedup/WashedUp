-- REVIEW ONLY: independent core-room read cursors, preserving original read tables.
-- New readers explicitly acknowledge observed source IDs; reads have no side effects.
BEGIN;
CREATE TABLE public.community_core_room_reads (
 community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 room_role text NOT NULL CHECK(room_role IN ('intros','main')),
 source text NOT NULL CHECK(source IN ('broadcast','topic')),
 through_at timestamptz NOT NULL,
 through_id uuid NOT NULL,
 PRIMARY KEY(community_id,user_id,room_role,source),
 CHECK(room_role='intros' OR source='broadcast')
);
ALTER TABLE public.community_core_room_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_core_room_reads FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.community_core_room_reads TO authenticated;

CREATE FUNCTION public.community_core_read_cursor_visible(p_community_id uuid,p_role text,p_source text,p_at timestamptz,p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public.is_community_member(p_community_id,auth.uid())
 AND EXISTS(SELECT 1 FROM public.communities WHERE id=p_community_id)
 AND EXISTS(SELECT 1 FROM public.community_chat_layouts l JOIN public.community_topics t ON t.id=l.intro_topic_id WHERE l.community_id=p_community_id AND NOT t.archived AND t.original_event_id IS NULL)
 AND (CASE WHEN p_source='broadcast' THEN EXISTS(SELECT 1 FROM public.community_broadcasts b WHERE b.community_id=p_community_id AND b.id=p_id AND b.created_at=p_at
   AND ((p_role='intros' AND b.kind='intro') OR (p_role='main' AND b.kind<>'intro')))
  WHEN p_source='topic' AND p_role='intros' THEN EXISTS(SELECT 1 FROM public.community_topic_messages m JOIN public.community_chat_layouts l ON l.intro_topic_id=m.topic_id
   WHERE l.community_id=p_community_id AND m.id=p_id AND m.created_at=p_at)
  ELSE false END);
$$;
REVOKE ALL ON FUNCTION public.community_core_read_cursor_visible(uuid,text,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.community_core_read_cursor_visible(uuid,text,text,timestamptz,uuid) TO authenticated;
CREATE POLICY community_core_reads_own ON public.community_core_room_reads FOR SELECT TO authenticated
 USING(user_id=auth.uid() AND public.is_community_member(community_id,auth.uid()) AND EXISTS(SELECT 1 FROM public.communities c WHERE c.id=community_id));
CREATE POLICY community_core_reads_insert ON public.community_core_room_reads FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND public.community_core_read_cursor_visible(community_id,room_role,source,through_at,through_id));
CREATE POLICY community_core_reads_update ON public.community_core_room_reads FOR UPDATE TO authenticated
 USING(user_id=auth.uid() AND public.is_community_member(community_id,auth.uid()))
 WITH CHECK(user_id=auth.uid() AND public.community_core_read_cursor_visible(community_id,room_role,source,through_at,through_id));
CREATE FUNCTION public.community_core_read_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.community_id IS DISTINCT FROM OLD.community_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.room_role IS DISTINCT FROM OLD.room_role OR NEW.source IS DISTINCT FROM OLD.source
 OR (NEW.through_at,NEW.through_id)<(OLD.through_at,OLD.through_id) THEN RAISE EXCEPTION 'A read position cannot move to another conversation or backwards' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.community_core_read_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER community_core_read_identity BEFORE UPDATE ON public.community_core_room_reads FOR EACH ROW EXECUTE FUNCTION public.community_core_read_identity();

CREATE FUNCTION public.get_community_core_read_state(p_community_id uuid,p_role text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_intro uuid; v_legacy_b timestamptz; v_legacy_t timestamptz; v_b public.community_core_room_reads; v_t public.community_core_room_reads; v_unread bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_community_member(p_community_id,auth.uid()) OR NOT EXISTS(SELECT 1 FROM public.communities WHERE id=p_community_id) THEN RAISE EXCEPTION 'Community chat unavailable' USING ERRCODE='42501'; END IF;
 IF p_role IS NULL OR p_role NOT IN ('intros','main') THEN RAISE EXCEPTION 'Invalid room' USING ERRCODE='22023'; END IF;
 SELECT intro_topic_id INTO v_intro FROM public.community_chat_layouts WHERE community_id=p_community_id;
 IF v_intro IS NULL OR NOT EXISTS(SELECT 1 FROM public.community_topics WHERE id=v_intro AND NOT archived AND original_event_id IS NULL) THEN RAISE EXCEPTION 'Community chats are not ready' USING ERRCODE='42501'; END IF;
 SELECT last_read_at INTO v_legacy_b FROM public.community_broadcast_reads WHERE community_id=p_community_id AND user_id=auth.uid();
 SELECT last_read_at INTO v_legacy_t FROM public.community_topic_reads WHERE topic_id=v_intro AND user_id=auth.uid();
 SELECT * INTO v_b FROM public.community_core_room_reads WHERE community_id=p_community_id AND user_id=auth.uid() AND room_role=p_role AND source='broadcast';
 SELECT * INTO v_t FROM public.community_core_room_reads WHERE community_id=p_community_id AND user_id=auth.uid() AND room_role=p_role AND source='topic';
 SELECT count(*) INTO v_unread FROM (
  SELECT b.id FROM public.community_broadcasts b WHERE b.community_id=p_community_id
   AND ((p_role='intros' AND b.kind='intro') OR (p_role='main' AND b.kind<>'intro'))
   AND b.sender_id IS DISTINCT FROM auth.uid() AND (b.sender_id IS NULL OR NOT public.yours_is_blocked_between(auth.uid(),b.sender_id))
   AND (v_legacy_b IS NULL OR b.created_at>v_legacy_b) AND (v_b.through_at IS NULL OR (b.created_at,b.id)>(v_b.through_at,v_b.through_id))
  UNION ALL
  SELECT m.id FROM public.community_topic_messages m WHERE p_role='intros' AND m.topic_id=v_intro
   AND m.sender_id IS DISTINCT FROM auth.uid() AND NOT public.yours_is_blocked_between(auth.uid(),m.sender_id)
   AND (v_legacy_t IS NULL OR m.created_at>v_legacy_t) AND (v_t.through_at IS NULL OR (m.created_at,m.id)>(v_t.through_at,v_t.through_id))
 ) unread_sources;
 RETURN jsonb_build_object('community_id',p_community_id,'role',p_role,'unread',v_unread,'broadcast',jsonb_build_object('through_at',v_b.through_at,'through_id',v_b.through_id,'legacy_read_at',v_legacy_b),
 'topic',CASE WHEN p_role='intros' THEN jsonb_build_object('through_at',v_t.through_at,'through_id',v_t.through_id,'legacy_read_at',v_legacy_t) ELSE NULL END);
END $$;

CREATE FUNCTION public.mark_community_core_room_read(p_community_id uuid,p_role text,p_broadcast_id uuid DEFAULT NULL,p_topic_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_at timestamptz; v_intro uuid;
BEGIN
 -- Validate current membership/layout, even for an empty acknowledgment.
 PERFORM public.get_community_core_read_state(p_community_id,p_role);
 IF p_role='main' AND p_topic_id IS NOT NULL THEN RAISE EXCEPTION 'A topic cursor does not belong to main' USING ERRCODE='22023'; END IF;
 IF p_broadcast_id IS NOT NULL THEN
  SELECT created_at INTO v_at FROM public.community_broadcasts WHERE id=p_broadcast_id AND community_id=p_community_id
   AND ((p_role='intros' AND kind='intro') OR (p_role='main' AND kind<>'intro'));
  IF NOT FOUND THEN RAISE EXCEPTION 'That message is unavailable in this room' USING ERRCODE='42501'; END IF;
  INSERT INTO public.community_core_room_reads(community_id,user_id,room_role,source,through_at,through_id)
  VALUES(p_community_id,auth.uid(),p_role,'broadcast',v_at,p_broadcast_id)
  ON CONFLICT(community_id,user_id,room_role,source) DO UPDATE SET through_at=excluded.through_at,through_id=excluded.through_id
  WHERE (community_core_room_reads.through_at,community_core_room_reads.through_id)<(excluded.through_at,excluded.through_id);
 END IF;
 IF p_topic_id IS NOT NULL THEN
  SELECT intro_topic_id INTO v_intro FROM public.community_chat_layouts WHERE community_id=p_community_id;
  SELECT created_at INTO v_at FROM public.community_topic_messages WHERE id=p_topic_id AND topic_id=v_intro;
  IF NOT FOUND THEN RAISE EXCEPTION 'That message is unavailable in Intros' USING ERRCODE='42501'; END IF;
  INSERT INTO public.community_core_room_reads(community_id,user_id,room_role,source,through_at,through_id)
  VALUES(p_community_id,auth.uid(),p_role,'topic',v_at,p_topic_id)
  ON CONFLICT(community_id,user_id,room_role,source) DO UPDATE SET through_at=excluded.through_at,through_id=excluded.through_id
  WHERE (community_core_room_reads.through_at,community_core_room_reads.through_id)<(excluded.through_at,excluded.through_id);
 END IF;
 RETURN public.get_community_core_read_state(p_community_id,p_role);
END $$;
REVOKE ALL ON FUNCTION public.get_community_core_read_state(uuid,text),public.mark_community_core_room_read(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_community_core_read_state(uuid,text),public.mark_community_core_room_read(uuid,text,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
