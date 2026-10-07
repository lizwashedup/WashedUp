-- LOCAL / REVIEW ONLY. Approved creators choose when content changes go live.
-- Private revision drafts never replace approval records or public content until
-- an explicit, version-checked publication. No notification/provider activity.
BEGIN;
CREATE TABLE public.creator_page_content_drafts (
 page_id uuid PRIMARY KEY REFERENCES public.creator_page_drafts(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>=0),
 published_version integer CHECK(published_version>=0 AND published_version<=version),
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.creator_page_content_attempts (
 request_id uuid PRIMARY KEY, page_id uuid NOT NULL, actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('save','publish')),
 expected_version integer NOT NULL CHECK(expected_version>=0),
 input_content jsonb, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.creator_page_content_drafts,public.creator_page_content_attempts FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.creator_page_content_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_page_content_attempts ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.creator_page_content_can_manage(p_page_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND CASE WHEN EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=p_page_id)
 THEN public.creator_page_team_can_manage(p_page_id,'page_content')
 ELSE EXISTS(
  SELECT 1 FROM public.creator_page_drafts d
  JOIN LATERAL(SELECT * FROM public.creator_page_submissions WHERE page_id=d.id ORDER BY revision DESC LIMIT 1)s ON s.status='approved'
  JOIN auth.users u ON u.id=d.owner_id JOIN public.profiles f ON f.id=u.id
  WHERE d.id=p_page_id AND d.owner_id=auth.uid() AND (u.banned_until IS NULL OR u.banned_until<=now())
   AND public.creator_page_audience_matches(coalesce(s.page_snapshot->>'audience','everyone'),auth.uid())
   AND NOT EXISTS(SELECT 1 FROM public.communities c WHERE c.id=d.id AND c.status NOT IN ('draft','active'))
 ) END;
$$;
REVOKE ALL ON FUNCTION public.creator_page_content_can_manage(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_creator_page_content(p_page_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.creator_page_drafts; p public.creator_page_publications; w public.creator_page_content_drafts;
 s public.creator_page_submissions; base jsonb; live jsonb; audience text;
BEGIN
 IF NOT public.creator_page_content_can_manage(p_page_id) THEN RAISE EXCEPTION 'Page editing unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.creator_page_drafts WHERE id=p_page_id;
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 SELECT * INTO w FROM public.creator_page_content_drafts WHERE page_id=p_page_id;
 IF p.page_id IS NOT NULL THEN
  live:=jsonb_build_object('name',p.name,'purpose',p.purpose,'city',p.city,'description',p.description,'photo_url',p.photo_url,
   'cover_media_id',(SELECT media_id::text FROM public.creator_page_cover_publications WHERE page_id=p_page_id));
  base:=live; audience:=p.audience;
 ELSE
  SELECT * INTO s FROM public.creator_page_submissions WHERE page_id=p_page_id ORDER BY revision DESC LIMIT 1;
  audience:=coalesce(s.page_snapshot->>'audience','everyone');
  base:=jsonb_build_object('name',d.page_data->>'name','purpose',d.page_data->>'purpose','city',d.page_data->>'city',
   'description',d.page_data->>'description','photo_url',d.page_data->>'photo_url','cover_media_id',d.page_data->>'cover_media_id');
 END IF;
 RETURN jsonb_build_object('page_id',p_page_id,'page_kind',d.page_kind,'state',CASE WHEN p.page_id IS NULL THEN 'approved' ELSE 'published' END,
  'audience',audience,'version',coalesce(w.version,0),
  'published_version',CASE WHEN w.page_id IS NOT NULL THEN w.published_version WHEN p.page_id IS NOT NULL THEN 0 ELSE NULL END,
  'content',coalesce(w.content,base),'live_content',live);
END;
$$;

CREATE FUNCTION public.creator_page_content_validate(p_page_id uuid,p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; normalized jsonb; media uuid; base jsonb;
BEGIN
 IF p_content IS NULL OR jsonb_typeof(p_content)<>'object'
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_content) f WHERE f NOT IN ('name','purpose','city','description','photo_url','cover_media_id')) THEN
  RAISE EXCEPTION 'Check the page details' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['name','purpose','city'] LOOP
  IF jsonb_typeof(p_content->k) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Complete the page details' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF length(btrim(p_content->>'name')) NOT BETWEEN 2 AND 60
 OR length(btrim(p_content->>'purpose')) NOT BETWEEN 10 AND 140
 OR length(btrim(p_content->>'city')) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Check the page name, purpose and city' USING ERRCODE='22023'; END IF;
 FOREACH k IN ARRAY ARRAY['description','photo_url','cover_media_id'] LOOP
  IF p_content ? k AND jsonb_typeof(p_content->k) NOT IN ('string','null') THEN RAISE EXCEPTION 'Check the page details' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF length(coalesce(p_content->>'description',''))>5000 THEN RAISE EXCEPTION 'About must be 5000 characters or fewer' USING ERRCODE='22023'; END IF;
 IF nullif(p_content->>'cover_media_id','') IS NOT NULL THEN
  media:=(p_content->>'cover_media_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.creator_page_media WHERE id=media AND page_id=p_page_id AND ready_at IS NOT NULL)
  OR nullif(p_content->>'photo_url','') IS NOT NULL THEN RAISE EXCEPTION 'Confirm this page photo before saving' USING ERRCODE='22023'; END IF;
 END IF;
 base:=public.get_creator_page_content(p_page_id);
 IF nullif(p_content->>'photo_url','') IS NOT NULL AND (p_content->>'photo_url') IS DISTINCT FROM (base->'content'->>'photo_url')
 AND (p_content->>'photo_url') IS DISTINCT FROM (base->'live_content'->>'photo_url') THEN
  RAISE EXCEPTION 'Choose a page photo through the photo picker' USING ERRCODE='22023'; END IF;
 normalized:=jsonb_build_object('name',btrim(p_content->>'name'),'purpose',btrim(p_content->>'purpose'),'city',btrim(p_content->>'city'),
  'description',nullif(btrim(p_content->>'description'),''),'photo_url',nullif(p_content->>'photo_url',''),'cover_media_id',media::text);
 RETURN normalized;
END;
$$;
REVOKE ALL ON FUNCTION public.creator_page_content_validate(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_creator_page_content_attempt(p_page_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_content_attempts;
BEGIN
 IF NOT public.creator_page_content_can_manage(p_page_id) THEN RAISE EXCEPTION 'Page editing unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_content_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NULL THEN RETURN NULL; END IF;
 IF a.page_id<>p_page_id OR a.actor_id<>auth.uid() THEN RAISE EXCEPTION 'Saved result unavailable' USING ERRCODE='42501'; END IF;
 RETURN a.receipt;
END;
$$;

CREATE FUNCTION public.save_creator_page_content(p_page_id uuid,p_request_id uuid,p_expected_version integer,p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_content_attempts; state jsonb; v_content jsonb; result jsonb; version integer;
BEGIN
 PERFORM 1 FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 PERFORM 1 FROM public.creator_page_publications WHERE page_id=p_page_id FOR UPDATE;
 IF NOT public.creator_page_content_can_manage(p_page_id) THEN RAISE EXCEPTION 'Page editing unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'Check the saved page version' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.creator_page_content_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.actor_id<>auth.uid() OR a.action<>'save' OR a.expected_version<>p_expected_version OR a.input_content IS DISTINCT FROM p_content THEN
   RAISE EXCEPTION 'Saved attempt does not match' USING ERRCODE='22023'; END IF;
  RETURN a.receipt;
 END IF;
 state:=public.get_creator_page_content(p_page_id);
 IF (state->>'version')::integer<>p_expected_version THEN RAISE EXCEPTION 'Page changed. Load the saved version before saving.' USING ERRCODE='PT409'; END IF;
 v_content:=public.creator_page_content_validate(p_page_id,p_content); version:=p_expected_version+1;
 INSERT INTO public.creator_page_content_drafts(page_id,version,published_version,content,updated_by)
 VALUES(p_page_id,version,(state->>'published_version')::integer,v_content,auth.uid())
 ON CONFLICT(page_id) DO UPDATE SET version=EXCLUDED.version,content=EXCLUDED.content,updated_by=EXCLUDED.updated_by,updated_at=now();
 result:=jsonb_build_object('request_id',p_request_id,'page_id',p_page_id,'actor_id',auth.uid(),'action','save','expected_version',p_expected_version,
  'version',version,'published_version',(state->>'published_version')::integer);
 INSERT INTO public.creator_page_content_attempts(request_id,page_id,actor_id,action,expected_version,input_content,receipt)
 VALUES(p_request_id,p_page_id,auth.uid(),'save',p_expected_version,p_content,result);
 RETURN result;
END;
$$;

CREATE FUNCTION public.publish_creator_page_content(p_page_id uuid,p_request_id uuid,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.creator_page_drafts; p public.creator_page_publications; s public.creator_page_submissions;
 a public.creator_page_content_attempts; state jsonb; v_content jsonb; result jsonb; media uuid;
BEGIN
 SELECT * INTO d FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id FOR UPDATE;
 IF NOT public.creator_page_content_can_manage(p_page_id) THEN RAISE EXCEPTION 'Page editing unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE EXCEPTION 'Check the saved page version' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.creator_page_content_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.actor_id<>auth.uid() OR a.action<>'publish' OR a.expected_version<>p_expected_version THEN
   RAISE EXCEPTION 'Saved attempt does not match' USING ERRCODE='22023'; END IF;
  RETURN a.receipt;
 END IF;
 state:=public.get_creator_page_content(p_page_id);
 IF (state->>'version')::integer<>p_expected_version THEN RAISE EXCEPTION 'Page changed. Preview the saved version before publishing.' USING ERRCODE='PT409'; END IF;
 v_content:=public.creator_page_content_validate(p_page_id,state->'content');
 IF p.page_id IS NULL THEN
  SELECT * INTO s FROM public.creator_page_submissions WHERE page_id=p_page_id ORDER BY revision DESC LIMIT 1 FOR UPDATE;
  IF s.status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'Page approval required' USING ERRCODE='42501'; END IF;
  IF d.page_kind='community' THEN PERFORM public.ensure_creator_page_community(p_page_id); END IF;
  INSERT INTO public.creator_page_publications(page_id,submission_id,page_kind,owner_id,name,purpose,city,description,photo_url,audience)
  VALUES(p_page_id,s.id,d.page_kind,d.owner_id,v_content->>'name',v_content->>'purpose',v_content->>'city',v_content->>'description',v_content->>'photo_url',state->>'audience');
  IF d.page_kind='community' THEN
   UPDATE public.communities SET status='active' WHERE id=p_page_id;
   INSERT INTO public.community_members(community_id,user_id,role,status,joined_at) VALUES(p_page_id,d.owner_id,'leader','active',now());
  END IF;
 ELSE
  UPDATE public.creator_page_publications SET name=v_content->>'name',purpose=v_content->>'purpose',city=v_content->>'city',
   description=v_content->>'description',photo_url=v_content->>'photo_url' WHERE page_id=p_page_id;
 END IF;
 IF d.page_kind='community' THEN
  UPDATE public.communities SET name=v_content->>'name',purpose=v_content->>'purpose',city=v_content->>'city',description=v_content->>'description' WHERE id=p_page_id;
  UPDATE public.community_blocks SET content=content || jsonb_build_object('tagline',v_content->>'purpose')
   WHERE community_id=p_page_id AND block_type='header';
  UPDATE public.community_blocks SET content=content || jsonb_build_object('text',coalesce(v_content->>'description',''))
   WHERE community_id=p_page_id AND block_type='about';
 END IF;
 media:=(v_content->>'cover_media_id')::uuid;
 IF media IS NULL THEN DELETE FROM public.creator_page_cover_publications WHERE page_id=p_page_id;
 ELSE INSERT INTO public.creator_page_cover_publications(page_id,media_id) VALUES(p_page_id,media)
  ON CONFLICT(page_id) DO UPDATE SET media_id=EXCLUDED.media_id; END IF;
 IF d.page_kind='community' THEN
  UPDATE public.community_blocks SET content=(community_blocks.content-'images'-'cover_media_id') ||
   CASE WHEN media IS NOT NULL THEN jsonb_build_object('images','[]'::jsonb,'cover_media_id',media)
    ELSE jsonb_build_object('images',CASE WHEN v_content->>'photo_url' IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_content->>'photo_url') END) END
  WHERE community_id=p_page_id AND block_type='cover';
 END IF;
 INSERT INTO public.creator_page_content_drafts(page_id,version,published_version,content,updated_by)
 VALUES(p_page_id,p_expected_version,p_expected_version,v_content,auth.uid())
 ON CONFLICT(page_id) DO UPDATE SET published_version=EXCLUDED.published_version,content=EXCLUDED.content,updated_by=EXCLUDED.updated_by,updated_at=now();
 result:=jsonb_build_object('request_id',p_request_id,'page_id',p_page_id,'actor_id',auth.uid(),'action','publish','expected_version',p_expected_version,
  'version',p_expected_version,'published_version',p_expected_version);
 INSERT INTO public.creator_page_content_attempts(request_id,page_id,actor_id,action,expected_version,receipt)
 VALUES(p_request_id,p_page_id,auth.uid(),'publish',p_expected_version,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_content(uuid),public.get_creator_page_content_attempt(uuid,uuid),
 public.save_creator_page_content(uuid,uuid,integer,jsonb),public.publish_creator_page_content(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_content(uuid),public.get_creator_page_content_attempt(uuid,uuid),
 public.save_creator_page_content(uuid,uuid,integer,jsonb),public.publish_creator_page_content(uuid,uuid,integer) TO authenticated;

-- Keep immutable objects, exact actor-owned upload reservations and existing
-- restrictive bucket policies; extend only to currently authorized page editors.
CREATE OR REPLACE FUNCTION public.creator_page_media_can_read(p_object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_media m WHERE m.object_name=p_object_name AND (
  (m.created_by=auth.uid() AND public.creator_page_is_owned(m.page_id)) OR public.is_admin(auth.uid())
  OR public.creator_page_content_can_manage(m.page_id)
  OR (m.ready_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.creator_page_cover_publications c
   WHERE c.media_id=m.id AND c.page_id=m.page_id AND public.creator_page_is_visible(c.page_id)))
 ));
$$;
CREATE OR REPLACE FUNCTION public.creator_page_media_can_upload(p_object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_media m WHERE m.object_name=p_object_name
 AND m.created_by=auth.uid() AND m.ready_at IS NULL AND (public.creator_page_is_owned(m.page_id) OR public.creator_page_content_can_manage(m.page_id)));
$$;
CREATE OR REPLACE FUNCTION public.reserve_creator_page_media(p_page_id uuid,p_media_id uuid,p_byte_size integer,p_mime_type text)
RETURNS public.creator_page_media LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_media;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.creator_page_is_owned(p_page_id) OR public.creator_page_content_can_manage(p_page_id)) THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 IF p_media_id IS NULL OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 8388608
 OR p_mime_type IS NULL OR p_mime_type NOT IN ('image/jpeg','image/png') THEN
  RAISE EXCEPTION 'Choose a JPEG or PNG cover within 8 MB' USING ERRCODE='22023'; END IF;
 INSERT INTO public.creator_page_media(id,page_id,object_name,created_by,byte_size,mime_type)
 VALUES(p_media_id,p_page_id,p_page_id::text||'/'||p_media_id::text||CASE p_mime_type WHEN 'image/jpeg' THEN '.jpg' ELSE '.png' END,auth.uid(),p_byte_size,p_mime_type)
 ON CONFLICT(id) DO NOTHING;
 SELECT * INTO m FROM public.creator_page_media WHERE id=p_media_id;
 IF m.page_id<>p_page_id OR m.created_by IS DISTINCT FROM auth.uid() OR m.byte_size<>p_byte_size OR m.mime_type<>p_mime_type THEN
  RAISE EXCEPTION 'This image does not match the saved attempt' USING ERRCODE='22023'; END IF;
 RETURN m;
END;
$$;
CREATE OR REPLACE FUNCTION public.complete_creator_page_media(p_page_id uuid,p_media_id uuid)
RETURNS public.creator_page_media LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_media; o storage.objects;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.creator_page_is_owned(p_page_id) OR public.creator_page_content_can_manage(p_page_id)) THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.creator_page_media WHERE id=p_media_id AND page_id=p_page_id FOR UPDATE;
 IF m.id IS NULL OR m.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Image unavailable' USING ERRCODE='42501'; END IF;
 IF m.ready_at IS NOT NULL THEN RETURN m; END IF;
 SELECT * INTO o FROM storage.objects WHERE bucket_id='creator-page-media' AND name=m.object_name;
 IF o.id IS NULL OR o.owner_id IS DISTINCT FROM auth.uid()::text
 OR (o.metadata->>'mimetype') IS DISTINCT FROM m.mime_type OR (o.metadata->>'size')::bigint IS DISTINCT FROM m.byte_size::bigint THEN
  RAISE EXCEPTION 'The image upload has not been confirmed' USING ERRCODE='PT409'; END IF;
 UPDATE public.creator_page_media SET ready_at=now() WHERE id=m.id RETURNING * INTO m;
 RETURN m;
END;
$$;
COMMIT;
