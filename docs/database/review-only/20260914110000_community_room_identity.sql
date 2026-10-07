-- REVIEW ONLY: D09 room identity/inclusion foundation. Not applied.
-- Target: inventoried creator-page test schema after 100. Managed/legacy replay
-- and existing account/page deletion defects remain separate release gates.
-- Main retains the existing community_broadcasts stream and community ID.
-- Intros reuses an eligible historical introductions topic (is_default), or
-- creates one independent topic. Never infer roles from a mutable room name.
-- Historical intro projection, optional-room actions, all-room mute, unread
-- aggregation and native hub are subsequent required work, not completed here.
BEGIN;
ALTER TABLE public.communities ADD COLUMN IF NOT EXISTS main_chat_name text DEFAULT 'community chat';
-- Keep event provenance when the existing event FK is cleared by deletion.
-- This is classification only, never a grant of chat access.
ALTER TABLE public.community_topics ADD COLUMN original_event_id uuid;
UPDATE public.community_topics SET original_event_id=explore_event_id WHERE explore_event_id IS NOT NULL;
GRANT SELECT(original_event_id) ON public.community_topics TO authenticated;
GRANT SELECT(main_chat_name) ON public.communities TO anon,authenticated;
CREATE TABLE public.community_chat_layouts (
 community_id uuid PRIMARY KEY REFERENCES public.communities(id) ON DELETE CASCADE,
 intro_topic_id uuid NOT NULL UNIQUE REFERENCES public.community_topics(id) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.community_chat_layouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_chat_layouts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.community_chat_layouts TO authenticated;
CREATE POLICY community_chat_layout_member_read ON public.community_chat_layouts FOR SELECT TO authenticated
 USING(public.is_community_member(community_id,auth.uid()));

-- Private provisioning is also used for new confirmed members. A read never
-- provisions rooms. No stored name, history or notification choice is replaced.
CREATE FUNCTION public.ensure_community_chat_layout(p_community_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_topic uuid; v_creator uuid;
BEGIN
 SELECT created_by INTO v_creator FROM public.communities WHERE id=p_community_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Community unavailable' USING ERRCODE='42501'; END IF;
 -- New-page rollout only; legacy authority/migration remains a release gate.
 IF NOT EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=p_community_id AND page_kind='community') THEN
  RAISE EXCEPTION 'This community is not ready for the new chat layout' USING ERRCODE='42501'; END IF;
 SELECT intro_topic_id INTO v_topic FROM public.community_chat_layouts WHERE community_id=p_community_id;
 IF v_topic IS NULL THEN
  SELECT id INTO v_topic FROM public.community_topics WHERE community_id=p_community_id AND is_default AND NOT archived AND explore_event_id IS NULL AND original_event_id IS NULL;
  IF v_topic IS NULL THEN
   INSERT INTO public.community_topics(community_id,name,created_by,is_default,archived)
   VALUES(p_community_id,'Intros',v_creator,false,false) RETURNING id INTO v_topic;
  END IF;
  INSERT INTO public.community_chat_layouts(community_id,intro_topic_id) VALUES(p_community_id,v_topic);
 END IF;
 -- Existing explicit topic settings win, including muted subscriptions and
 -- their original joined_at. New automatic subscriptions do not opt into push.
 INSERT INTO public.community_topic_members(topic_id,user_id,notifications_on)
 SELECT v_topic,user_id,false FROM public.community_members WHERE community_id=p_community_id AND status='active'
 ON CONFLICT(topic_id,user_id) DO NOTHING;
 RETURN v_topic;
END $$;
REVOKE ALL ON FUNCTION public.ensure_community_chat_layout(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.provision_published_community_chat_layout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.page_kind='community' THEN PERFORM public.ensure_community_chat_layout(NEW.page_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provision_published_community_chat_layout AFTER INSERT ON public.creator_page_publications
 FOR EACH ROW EXECUTE FUNCTION public.provision_published_community_chat_layout();

CREATE FUNCTION public.include_confirmed_member_in_community_intros() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_topic uuid;
BEGIN
 IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  -- Serialize inclusion with publication/provisioning before reading its layout.
  PERFORM 1 FROM public.communities WHERE id=NEW.community_id FOR UPDATE;
  SELECT intro_topic_id INTO v_topic FROM public.community_chat_layouts WHERE community_id=NEW.community_id;
  IF v_topic IS NOT NULL THEN
   INSERT INTO public.community_topic_members(topic_id,user_id,notifications_on) VALUES(v_topic,NEW.user_id,false)
   ON CONFLICT(topic_id,user_id) DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER include_confirmed_member_in_community_intros AFTER INSERT OR UPDATE OF status ON public.community_members
 FOR EACH ROW EXECUTE FUNCTION public.include_confirmed_member_in_community_intros();

-- Identity changes are not renames and were never part of the member APIs.
-- Preserve individual notification updates and legitimate ordinary-room leave.
CREATE FUNCTION public.community_topic_subscription_identity_and_inclusion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.topic_id IS DISTINCT FROM OLD.topic_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.joined_at IS DISTINCT FROM OLD.joined_at) THEN
  RAISE EXCEPTION 'A room subscription cannot be moved to another room or account' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.community_chat_layouts l JOIN public.community_members m ON m.community_id=l.community_id
  WHERE l.intro_topic_id=OLD.topic_id AND m.user_id=OLD.user_id AND m.status='active'
   AND EXISTS(SELECT 1 FROM public.communities WHERE id=l.community_id)
   AND EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id)) THEN
  -- Whole-community/account cascades must remain possible. Parent deletion
  -- removes the corresponding active row/layout before its cascading child.
  RAISE EXCEPTION 'Intros stays included while you belong to this community. You can mute it instead.' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER community_topic_subscription_identity_and_inclusion BEFORE UPDATE OR DELETE ON public.community_topic_members
 FOR EACH ROW EXECUTE FUNCTION public.community_topic_subscription_identity_and_inclusion();

CREATE FUNCTION public.community_topic_identity_and_core_room_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.original_event_id:=NEW.explore_event_id; RETURN NEW; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.community_id IS DISTINCT FROM OLD.community_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NEW.original_event_id IS DISTINCT FROM OLD.original_event_id
 OR (NEW.created_by IS DISTINCT FROM OLD.created_by AND NOT (NEW.created_by IS NULL AND OLD.created_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.created_by)))
 OR (NEW.explore_event_id IS DISTINCT FROM OLD.explore_event_id AND NOT (NEW.explore_event_id IS NULL AND OLD.explore_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.explore_events WHERE id=OLD.explore_event_id))) THEN
  RAISE EXCEPTION 'A conversation identity cannot be changed' USING ERRCODE='42501';
 END IF;
 IF NEW.archived AND NOT OLD.archived AND EXISTS(SELECT 1 FROM public.community_chat_layouts WHERE intro_topic_id=OLD.id) THEN
  RAISE EXCEPTION 'Intros stays included with this community' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER community_topic_identity_and_core_room_guard BEFORE INSERT OR UPDATE ON public.community_topics
 FOR EACH ROW EXECUTE FUNCTION public.community_topic_identity_and_core_room_guard();

CREATE FUNCTION public.get_community_room_identities(p_community_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v_intro uuid; v_name text; v_main text; v_rooms jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_community_member(p_community_id,auth.uid()) THEN RAISE EXCEPTION 'Join this community to open its chats' USING ERRCODE='42501'; END IF;
 SELECT intro_topic_id INTO v_intro FROM public.community_chat_layouts WHERE community_id=p_community_id;
 IF v_intro IS NULL THEN RETURN NULL; END IF;
 SELECT name,coalesce(nullif(btrim(main_chat_name),''),'community chat') INTO v_name,v_main FROM public.communities WHERE id=p_community_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Community unavailable' USING ERRCODE='42501'; END IF;
 SELECT jsonb_agg(room ORDER BY position,sort_at,sort_id) INTO v_rooms FROM (
  SELECT jsonb_build_object('id',t.id,'role','intros','name',t.name,'storage','topic','included',true,'joined',true,'notifications_on',tm.notifications_on) room,
   0 position,t.created_at sort_at,t.id sort_id FROM public.community_topics t
   JOIN public.community_topic_members tm ON tm.topic_id=t.id AND tm.user_id=auth.uid() WHERE t.id=v_intro AND NOT t.archived AND t.explore_event_id IS NULL AND t.original_event_id IS NULL
  UNION ALL
  SELECT jsonb_build_object('id',p_community_id,'role','main','name',v_main,'storage','broadcast','included',true,'joined',true,'notifications_on',NOT m.broadcasts_muted),
   1,m.created_at,p_community_id FROM public.community_members m WHERE m.community_id=p_community_id AND m.user_id=auth.uid() AND m.status='active'
  UNION ALL
  SELECT jsonb_build_object('id',t.id,'role','optional','name',t.name,'storage','topic','included',false,'joined',tm.user_id IS NOT NULL,'notifications_on',tm.notifications_on),
   2,t.created_at,t.id FROM public.community_topics t LEFT JOIN public.community_topic_members tm ON tm.topic_id=t.id AND tm.user_id=auth.uid()
   WHERE t.community_id=p_community_id AND t.id<>v_intro AND NOT t.archived AND t.explore_event_id IS NULL AND t.original_event_id IS NULL
 ) ordered_rooms;
 RETURN jsonb_build_object('community_id',p_community_id,'name',v_name,'rooms',coalesce(v_rooms,'[]'::jsonb));
END $$;

-- Owner authority for new pages; existing co-leader/team expansion is not assumed.
CREATE FUNCTION public.rename_community_core_room(p_community_id uuid,p_role text,p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_intro uuid;
BEGIN
 PERFORM 1 FROM public.communities WHERE id=p_community_id FOR UPDATE;
 IF auth.uid() IS NULL OR NOT public.is_community_member(p_community_id,auth.uid()) OR NOT EXISTS(
  SELECT 1 FROM public.creator_page_publications WHERE page_id=p_community_id AND owner_id=auth.uid() AND page_kind='community') THEN
  RAISE EXCEPTION 'Only this page creator can rename its included chats' USING ERRCODE='42501'; END IF;
 IF p_role IS NULL OR p_role NOT IN ('intros','main') OR p_name IS NULL OR btrim(p_name)='' OR char_length(btrim(p_name))>60 THEN RAISE EXCEPTION 'Use a chat name of 1 to 60 characters' USING ERRCODE='22023'; END IF;
 SELECT intro_topic_id INTO v_intro FROM public.community_chat_layouts WHERE community_id=p_community_id;
 IF v_intro IS NULL THEN RAISE EXCEPTION 'These chats are not ready yet' USING ERRCODE='42501'; END IF;
 IF p_role='intros' THEN UPDATE public.community_topics SET name=btrim(p_name) WHERE id=v_intro;
 ELSE UPDATE public.communities SET main_chat_name=btrim(p_name) WHERE id=p_community_id; END IF;
 RETURN jsonb_build_object('community_id',p_community_id,'id',CASE WHEN p_role='intros' THEN v_intro ELSE p_community_id END,'role',p_role,'name',btrim(p_name));
END $$;
REVOKE ALL ON FUNCTION public.get_community_room_identities(uuid),public.rename_community_core_room(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_community_room_identities(uuid),public.rename_community_core_room(uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
