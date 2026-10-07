-- REVIEW ONLY. A stale expected name is an application conflict, not a
-- transaction serialization failure. The previous 40001 timed out over HTTP.
BEGIN;
CREATE OR REPLACE FUNCTION public.rename_community_room(p_community_id uuid,p_room_id uuid,p_role text,p_name text,p_expected_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual_name text; actual_id uuid;
BEGIN
 PERFORM 1 FROM public.communities WHERE id=p_community_id FOR UPDATE;
 PERFORM 1 FROM public.community_members WHERE community_id=p_community_id AND user_id=auth.uid() AND status='active' FOR SHARE;
 IF NOT public.creator_community_group_authorized(p_community_id) THEN RAISE EXCEPTION 'Only this page creator can rename its chats' USING ERRCODE='42501'; END IF;
 IF p_role IS NULL OR p_role NOT IN ('intros','main','optional') OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 60 OR p_name ~ '^[[:space:]]*$' OR p_name ~ '[[:cntrl:]]' OR p_expected_name IS NULL THEN
  RAISE EXCEPTION 'Use a chat name of 1 to 60 characters' USING ERRCODE='22023'; END IF;
 IF p_role='main' THEN
  SELECT id,coalesce(nullif(btrim(main_chat_name),''),'community chat') INTO actual_id,actual_name FROM public.communities WHERE id=p_community_id;
 ELSIF p_role='intros' THEN
  SELECT t.id,t.name INTO actual_id,actual_name FROM public.community_chat_layouts l JOIN public.community_topics t ON t.id=l.intro_topic_id WHERE l.community_id=p_community_id AND NOT t.archived FOR UPDATE OF t;
 ELSE
  SELECT t.id,t.name INTO actual_id,actual_name FROM public.community_topics t WHERE t.id=p_room_id AND t.community_id=p_community_id AND NOT t.archived
   AND t.explore_event_id IS NULL AND t.original_event_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.community_chat_layouts WHERE intro_topic_id=t.id) FOR UPDATE OF t;
 END IF;
 IF actual_id IS NULL OR actual_id IS DISTINCT FROM p_room_id THEN RAISE EXCEPTION 'This chat is unavailable' USING ERRCODE='42501'; END IF;
 IF actual_name<>p_expected_name AND actual_name<>btrim(p_name) THEN RAISE EXCEPTION 'This chat name changed. Refresh before saving.' USING ERRCODE='PT409'; END IF;
 IF p_role IN ('intros','main') THEN RETURN public.rename_community_core_room(p_community_id,p_role,btrim(p_name)); END IF;
 UPDATE public.community_topics SET name=btrim(p_name) WHERE id=actual_id;
 RETURN jsonb_build_object('community_id',p_community_id,'id',actual_id,'role','optional','name',btrim(p_name));
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
