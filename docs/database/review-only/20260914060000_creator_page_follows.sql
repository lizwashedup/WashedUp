-- LOCAL / REVIEW ONLY: organization page follows, separate from legacy account follows.
-- No recipient fanout, profile migration, membership or chat grants.
BEGIN;
CREATE TABLE public.creator_page_follow_states (
 page_id uuid NOT NULL REFERENCES public.creator_page_publications(page_id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 following boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(page_id,user_id)
);
CREATE INDEX creator_page_follow_counts ON public.creator_page_follow_states(page_id) WHERE following;
CREATE TABLE public.creator_page_follow_attempts (
 id uuid PRIMARY KEY,
 page_id uuid NOT NULL,
 user_id uuid NOT NULL,
 expected_version integer NOT NULL CHECK(expected_version>=0),
 following boolean NOT NULL,
 result_version integer NOT NULL CHECK(result_version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(page_id,user_id) REFERENCES public.creator_page_follow_states(page_id,user_id) ON DELETE CASCADE
);
REVOKE ALL ON public.creator_page_follow_states,public.creator_page_follow_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.creator_page_follow_states,public.creator_page_follow_attempts TO authenticated;
ALTER TABLE public.creator_page_follow_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_page_follow_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_page_follow_own ON public.creator_page_follow_states FOR SELECT USING(user_id=auth.uid());
CREATE POLICY creator_page_follow_attempt_own ON public.creator_page_follow_attempts FOR SELECT USING(user_id=auth.uid());
CREATE FUNCTION public.get_creator_page_follow_state(p_page_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.creator_page_follow_states; u uuid:=auth.uid();
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Sign in to check following' USING ERRCODE='PT401'; END IF;
 SELECT * INTO s FROM public.creator_page_follow_states WHERE page_id=p_page_id AND user_id=u;
 IF s.page_id IS NOT NULL THEN RETURN to_jsonb(s); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.creator_page_publications p WHERE p.page_id=p_page_id
  AND p.page_kind='organization' AND public.creator_page_is_visible(p.page_id)) THEN
  RAISE EXCEPTION 'This organization page is unavailable' USING ERRCODE='PT404';
 END IF;
 RETURN jsonb_build_object('page_id',p_page_id,'user_id',u,'following',false,'version',0);
END;
$$;
CREATE FUNCTION public.get_creator_page_follower_count(p_page_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.creator_page_publications p WHERE p.page_id=p_page_id
 AND p.page_kind='organization' AND public.creator_page_is_visible(p.page_id))
 THEN (SELECT count(*) FROM public.creator_page_follow_states f WHERE f.page_id=p_page_id AND f.following) ELSE NULL END;
$$;
CREATE FUNCTION public.set_creator_page_follow(p_page_id uuid,p_attempt_id uuid,p_expected_version integer,p_following boolean)
RETURNS public.creator_page_follow_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); p public.creator_page_publications; s public.creator_page_follow_states;
 receipt public.creator_page_follow_attempts;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Sign in to follow this page' USING ERRCODE='PT401'; END IF;
 IF p_page_id IS NULL OR p_attempt_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR p_following IS NULL THEN
  RAISE EXCEPTION 'Invalid follow attempt' USING ERRCODE='PT400';
 END IF;
 SELECT * INTO receipt FROM public.creator_page_follow_attempts WHERE id=p_attempt_id;
 IF receipt.id IS NOT NULL THEN
  IF receipt.user_id=u AND receipt.page_id=p_page_id AND receipt.expected_version=p_expected_version AND receipt.following=p_following THEN RETURN receipt; END IF;
  RAISE EXCEPTION 'This follow attempt does not match' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id FOR SHARE;
 IF p.page_id IS NULL OR p.page_kind<>'organization' THEN
  RAISE EXCEPTION 'This organization page is unavailable' USING ERRCODE='PT404';
 END IF;
 IF p_following AND (p.owner_id=u OR NOT public.creator_page_is_visible(p.page_id)) THEN
  RAISE EXCEPTION 'This page cannot be followed by this account' USING ERRCODE='PT403';
 END IF;
 INSERT INTO public.creator_page_follow_states(page_id,user_id) VALUES(p_page_id,u) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.creator_page_follow_states WHERE page_id=p_page_id AND user_id=u FOR UPDATE;
 -- A concurrent copy of the same attempt may have completed while this call waited.
 SELECT * INTO receipt FROM public.creator_page_follow_attempts WHERE id=p_attempt_id;
 IF receipt.id IS NOT NULL THEN
  IF receipt.user_id=u AND receipt.page_id=p_page_id AND receipt.expected_version=p_expected_version AND receipt.following=p_following THEN RETURN receipt; END IF;
  RAISE EXCEPTION 'This follow attempt does not match' USING ERRCODE='PT409';
 END IF;
 IF s.version<>p_expected_version THEN RAISE EXCEPTION 'Following changed. Check the current state.' USING ERRCODE='PT409'; END IF;
 UPDATE public.creator_page_follow_states SET following=p_following,version=version+1,updated_at=now()
 WHERE page_id=p_page_id AND user_id=u RETURNING * INTO s;
 INSERT INTO public.creator_page_follow_attempts(id,page_id,user_id,expected_version,following,result_version)
 VALUES(p_attempt_id,p_page_id,u,p_expected_version,p_following,s.version) RETURNING * INTO receipt;
 RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_follow_state(uuid),public.get_creator_page_follower_count(uuid),
 public.set_creator_page_follow(uuid,uuid,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_follow_state(uuid),public.set_creator_page_follow(uuid,uuid,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_page_follower_count(uuid) TO anon,authenticated;
COMMIT;
