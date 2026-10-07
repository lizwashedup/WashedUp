-- REVIEW ONLY. Local creator-page joining receipts and interrupted-request recovery.
-- Reuses 090 admission; no room/history migration, provider call or legacy rollout.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.request_to_join_community(uuid,jsonb)'::regprocedure))<>'25a8d44bfcbbce375d24d23c4cf75f36' THEN RAISE EXCEPTION 'Admission dependency differs from verified 090; reconcile before applying'; END IF;
END $guard$;
CREATE TABLE public.creator_community_join_requests (
 id uuid PRIMARY KEY,
 page_id uuid NOT NULL REFERENCES public.creator_page_publications(page_id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 settings_version integer CHECK(settings_version>=0),
 answer_hash text,
 member_id uuid, -- historical own membership identity; deletion is represented by current_status=NULL
 outcome text NOT NULL CHECK(outcome IN ('submitted','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT creator_community_join_request_shape CHECK (
  (outcome='submitted' AND settings_version IS NOT NULL AND answer_hash IS NOT NULL AND member_id IS NOT NULL)
  OR (outcome='cancelled' AND settings_version IS NULL AND answer_hash IS NULL AND member_id IS NULL))
);
ALTER TABLE public.creator_community_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_community_join_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,page_id,user_id,settings_version,member_id,outcome,created_at) ON public.creator_community_join_requests TO authenticated;
CREATE POLICY creator_community_join_request_own ON public.creator_community_join_requests FOR SELECT TO authenticated USING(user_id=auth.uid());

CREATE FUNCTION public.get_creator_community_join_request(p_page_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.creator_community_join_requests; v_status text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to check this request' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.creator_community_join_requests WHERE id=p_request_id AND page_id=p_page_id AND user_id=auth.uid();
 IF r.id IS NULL THEN RETURN NULL; END IF;
 SELECT status::text INTO v_status FROM public.community_members WHERE id=r.member_id AND user_id=auth.uid() AND community_id=p_page_id;
 RETURN jsonb_build_object('id',r.id,'page_id',r.page_id,'user_id',r.user_id,'settings_version',r.settings_version,
  'member_id',r.member_id,'outcome',r.outcome,'current_status',v_status,'created_at',r.created_at);
END $$;

CREATE FUNCTION public.request_creator_community_join(p_page_id uuid,p_request_id uuid,p_settings_version integer,p_answers jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.creator_community_join_requests; v_version integer; v_member uuid; v_hash text;
BEGIN
 IF auth.uid() IS NULL OR p_page_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Sign in to join this community' USING ERRCODE='42501'; END IF;
 IF p_settings_version IS NULL OR p_settings_version<0 OR p_answers IS NULL OR jsonb_typeof(p_answers)<>'object' THEN RAISE EXCEPTION 'Joining answers are required' USING ERRCODE='22023'; END IF;
 -- Match the existing settings/request/review lock order. The wrapper retains
 -- this lock through version validation, admission, and receipt insertion.
 PERFORM 1 FROM public.communities WHERE id=p_page_id FOR UPDATE;
 SELECT * INTO r FROM public.creator_community_join_requests WHERE id=p_request_id;
 v_hash:=encode(sha256(convert_to(p_answers::text,'UTF8')),'hex');
 IF r.id IS NOT NULL THEN
  IF r.page_id<>p_page_id OR r.user_id<>auth.uid() THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
  IF r.outcome='cancelled' THEN RETURN public.get_creator_community_join_request(p_page_id,p_request_id); END IF;
  IF r.settings_version<>p_settings_version OR r.answer_hash<>v_hash THEN RAISE EXCEPTION 'This request already contains different answers' USING ERRCODE='PT409'; END IF;
  RETURN public.get_creator_community_join_request(p_page_id,p_request_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=p_page_id AND page_kind='community')
 OR NOT public.creator_community_is_visible(p_page_id) THEN RAISE EXCEPTION 'This community is unavailable' USING ERRCODE='42501'; END IF;
 SELECT creator_page_join_settings_version INTO v_version FROM public.communities WHERE id=p_page_id;
 IF v_version IS DISTINCT FROM p_settings_version THEN RAISE EXCEPTION 'These joining questions have changed. Review the current questions before sending.' USING ERRCODE='PT409'; END IF;
 PERFORM public.request_to_join_community(p_page_id,p_answers);
 SELECT id INTO v_member FROM public.community_members WHERE community_id=p_page_id AND user_id=auth.uid() AND status IN ('pending','active');
 IF v_member IS NULL THEN RAISE EXCEPTION 'Admission could not be confirmed'; END IF;
 INSERT INTO public.creator_community_join_requests(id,page_id,user_id,settings_version,answer_hash,member_id,outcome)
 VALUES(p_request_id,p_page_id,auth.uid(),p_settings_version,v_hash,v_member,'submitted');
 RETURN public.get_creator_community_join_request(p_page_id,p_request_id);
END $$;

-- An explicit cancellation settles an unknown request without guessing from a
-- temporarily absent membership. It cannot reverse an admission that committed.
-- A late delivery carrying this same request ID sees the cancellation receipt.
CREATE FUNCTION public.cancel_creator_community_join_request(p_page_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.creator_community_join_requests;
BEGIN
 IF auth.uid() IS NULL OR p_page_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Sign in to check this request' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.communities WHERE id=p_page_id FOR UPDATE;
 SELECT * INTO r FROM public.creator_community_join_requests WHERE id=p_request_id;
 IF r.id IS NOT NULL THEN
  IF r.page_id<>p_page_id OR r.user_id<>auth.uid() THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
  RETURN public.get_creator_community_join_request(p_page_id,p_request_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=p_page_id AND page_kind='community')
 OR NOT public.creator_community_is_visible(p_page_id) THEN RAISE EXCEPTION 'This community is unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.creator_community_join_requests(id,page_id,user_id,outcome) VALUES(p_request_id,p_page_id,auth.uid(),'cancelled');
 RETURN public.get_creator_community_join_request(p_page_id,p_request_id);
END $$;
REVOKE ALL ON FUNCTION public.get_creator_community_join_request(uuid,uuid),public.request_creator_community_join(uuid,uuid,integer,jsonb),public.cancel_creator_community_join_request(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_community_join_request(uuid,uuid),public.request_creator_community_join(uuid,uuid,integer,jsonb),public.cancel_creator_community_join_request(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
