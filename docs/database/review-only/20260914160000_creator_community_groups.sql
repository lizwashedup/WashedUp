-- REVIEW ONLY. Restore September 12 creator-made groups without replacing rooms.
-- Requires verified creator publication and stable Intros/main room identities.
BEGIN;
CREATE TABLE public.community_group_creation_receipts (
 id uuid PRIMARY KEY,
 community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
 creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 requested_name text NOT NULL CHECK (btrim(requested_name)=requested_name AND char_length(requested_name) BETWEEN 1 AND 60 AND requested_name !~ '^[[:space:]]*$' AND requested_name !~ '[[:cntrl:]]'),
 created_at timestamptz NOT NULL DEFAULT now()
);
-- The receipt deliberately outlives topic deletion. Retrying a deleted group
-- must not recreate it. Whole-community/account removal still cascades.
ALTER TABLE public.community_group_creation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_group_creation_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.creator_community_group_authorized(p_community_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public.is_community_member(p_community_id,auth.uid())
 AND EXISTS(SELECT 1 FROM public.creator_page_publications p WHERE p.page_id=p_community_id AND p.owner_id=auth.uid() AND p.page_kind='community')
 AND EXISTS(SELECT 1 FROM public.community_chat_layouts WHERE community_id=p_community_id);
$$;
REVOKE ALL ON FUNCTION public.creator_community_group_authorized(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.community_group_creation_result(p_receipt public.community_group_creation_receipts) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('community_id',p_receipt.community_id,'id',p_receipt.id,'requested_name',p_receipt.requested_name,
  'name',t.name,'status',CASE WHEN t.id IS NULL THEN 'unavailable' WHEN t.archived THEN 'archived' ELSE 'available' END)
 FROM (SELECT 1) seed LEFT JOIN public.community_topics t ON t.id=p_receipt.id AND t.community_id=p_receipt.community_id;
$$;
REVOKE ALL ON FUNCTION public.community_group_creation_result(public.community_group_creation_receipts) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_community_group_creation(p_community_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.community_group_creation_receipts;
BEGIN
 IF NOT public.creator_community_group_authorized(p_community_id) THEN RAISE EXCEPTION 'Only this page creator can manage its groups' USING ERRCODE='42501'; END IF;
 SELECT * INTO receipt FROM public.community_group_creation_receipts WHERE id=p_request_id AND community_id=p_community_id AND creator_id=auth.uid();
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.community_group_creation_result(receipt);
END $$;
CREATE FUNCTION public.create_community_group(p_community_id uuid,p_request_id uuid,p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.community_group_creation_receipts; inserted integer;
BEGIN
 -- Serializes create/rename/publication/departure changes for this page.
 PERFORM 1 FROM public.communities WHERE id=p_community_id FOR UPDATE;
 PERFORM 1 FROM public.community_members WHERE community_id=p_community_id AND user_id=auth.uid() AND status='active' FOR SHARE;
 IF NOT public.creator_community_group_authorized(p_community_id) THEN RAISE EXCEPTION 'Only this page creator can create its groups' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 60 OR p_name ~ '^[[:space:]]*$' OR p_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Use a group name of 1 to 60 characters' USING ERRCODE='22023'; END IF;
 INSERT INTO public.community_group_creation_receipts(id,community_id,creator_id,requested_name)
 VALUES(p_request_id,p_community_id,auth.uid(),btrim(p_name)) ON CONFLICT(id) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 SELECT * INTO receipt FROM public.community_group_creation_receipts WHERE id=p_request_id FOR UPDATE;
 IF receipt.community_id<>p_community_id OR receipt.creator_id<>auth.uid() OR receipt.requested_name<>btrim(p_name) THEN
  RAISE EXCEPTION 'This saved group attempt belongs to a different request' USING ERRCODE='42501'; END IF;
 IF inserted=1 THEN
  INSERT INTO public.community_topics(id,community_id,name,created_by,is_default)
  VALUES(p_request_id,p_community_id,btrim(p_name),auth.uid(),false);
  -- Creation includes its creator only. Other members opt in; no notices or
  -- core membership/mute/read changes are part of creating a group.
  INSERT INTO public.community_topic_members(topic_id,user_id) VALUES(p_request_id,auth.uid()) ON CONFLICT(topic_id,user_id) DO NOTHING;
 END IF;
 RETURN public.community_group_creation_result(receipt);
END $$;
CREATE FUNCTION public.rename_community_room(p_community_id uuid,p_room_id uuid,p_role text,p_name text,p_expected_name text) RETURNS jsonb
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
 IF actual_name<>p_expected_name AND actual_name<>btrim(p_name) THEN RAISE EXCEPTION 'This chat name changed. Refresh before saving.' USING ERRCODE='40001'; END IF;
 IF p_role IN ('intros','main') THEN RETURN public.rename_community_core_room(p_community_id,p_role,btrim(p_name)); END IF;
 UPDATE public.community_topics SET name=btrim(p_name) WHERE id=actual_id;
 RETURN jsonb_build_object('community_id',p_community_id,'id',actual_id,'role','optional','name',btrim(p_name));
END $$;
REVOKE ALL ON FUNCTION public.get_community_group_creation(uuid,uuid),public.create_community_group(uuid,uuid,text),public.rename_community_room(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_community_group_creation(uuid,uuid),public.create_community_group(uuid,uuid,text),public.rename_community_room(uuid,uuid,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
