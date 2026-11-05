-- REVIEW ONLY: not deployed. Restore creator discovery controls through a scoped RPC.
-- Does not grant direct column UPDATE, publish a page, alter admission or rewrite any rows.
BEGIN;
DO $guard$ BEGIN
 IF to_regprocedure('public.is_community_leader(uuid,uuid)') IS NULL
 OR md5(pg_get_functiondef('public.is_community_leader(uuid,uuid)'::regprocedure)) <> 'd9a2d97a0ef34d456087e6df78a8c73d' THEN
  RAISE EXCEPTION 'Community creator authority changed; inspect the deployed contract';
 END IF;
 IF to_regprocedure('public.get_community_visibility_options(uuid)') IS NOT NULL
 OR to_regprocedure('public.set_community_discoverable(uuid,text,boolean,boolean)') IS NOT NULL THEN
  RAISE EXCEPTION 'Discovery control already exists; inspect before applying';
 END IF;
 IF has_column_privilege('authenticated','public.communities','discoverable','UPDATE') THEN
  RAISE EXCEPTION 'Discovery column grants changed; inspect before applying';
 END IF;
END $guard$;

CREATE FUNCTION public.get_community_visibility_options(p_community_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_community_leader(p_community_id,auth.uid())
 OR NOT EXISTS(SELECT 1 FROM public.communities WHERE id=p_community_id) THEN
  RAISE EXCEPTION 'Community creator access required' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('version',1,'community_id',p_community_id,'can_change_discovery',true);
END;
$$;

CREATE FUNCTION public.set_community_discoverable(
 p_community_id uuid,p_expected_status text,p_expected_discoverable boolean,p_discoverable boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); v_community public.communities; v_role text;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
 IF p_expected_status IS NULL OR p_expected_status NOT IN ('draft','active')
 OR p_expected_discoverable IS NULL OR p_discoverable IS NULL THEN
  RAISE EXCEPTION 'Check the visibility choice' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_community FROM public.communities WHERE id=p_community_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Community unavailable' USING ERRCODE='42501'; END IF;
 -- Lock the same membership used for authorization: a concurrent role revocation
 -- must settle before this action can use that role.
 SELECT role::text INTO v_role FROM public.community_members
 WHERE community_id=p_community_id AND user_id=v_uid AND status='active' FOR UPDATE;
 IF v_role IS NULL OR v_role NOT IN ('leader','co_leader')
 OR NOT public.is_community_leader(p_community_id,v_uid) THEN
  RAISE EXCEPTION 'Community creator access required' USING ERRCODE='42501';
 END IF;
 IF v_community.status::text <> p_expected_status OR v_community.status::text='archived'
 OR v_community.discoverable IS DISTINCT FROM p_expected_discoverable THEN
  RAISE EXCEPTION 'Community settings changed; check the saved status' USING ERRCODE='PT409';
 END IF;
 UPDATE public.communities SET discoverable=p_discoverable WHERE id=p_community_id
 RETURNING * INTO v_community;
 RETURN jsonb_build_object('id',v_community.id,'status',v_community.status,'discoverable',v_community.discoverable);
END;
$$;
REVOKE ALL ON FUNCTION public.get_community_visibility_options(uuid),public.set_community_discoverable(uuid,text,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_community_visibility_options(uuid),public.set_community_discoverable(uuid,text,boolean,boolean) TO authenticated;
COMMIT;
