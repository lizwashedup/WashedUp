-- LOCAL / REVIEW ONLY. Install together with the trusted verifier and callers.
-- Rollback-test first; never grandfather a previously confirmed unverified reuse.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.creator_page_event_media_reuse r JOIN public.creator_page_event_media m ON m.id=r.media_id WHERE m.ready_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Confirmed reused media requires integrity reconciliation' USING ERRCODE='55000';
 END IF;
END; $$;
CREATE TABLE public.creator_page_event_media_verifications (
 media_id uuid PRIMARY KEY REFERENCES public.creator_page_event_media(id),
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object'),
 raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^[0-9a-f]{64}$'),
 source_digest_kind text NOT NULL CHECK(source_digest_kind IN('raw-sha256','native-md5-manifest-v1')),
 verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.creator_page_event_media_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_event_media_verifications FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.creator_page_event_media_object_binding(p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media; o storage.objects;
BEGIN
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id;
 SELECT * INTO o FROM storage.objects WHERE bucket_id='creator-event-media' AND name=m.object_name;
 IF m.id IS NULL OR m.abandoned_at IS NOT NULL OR o.id IS NULL OR nullif(o.version,'') IS NULL OR o.updated_at IS NULL
 OR o.owner_id IS DISTINCT FROM m.created_by::text OR o.metadata->>'mimetype' IS DISTINCT FROM m.mime_type
 OR (o.metadata->>'size')::bigint IS DISTINCT FROM m.byte_size THEN RAISE EXCEPTION 'Media object unavailable for verification' USING ERRCODE='PT409'; END IF;
 RETURN jsonb_build_object('media_id',m.id,'page_id',m.page_id,'event_id',m.event_id,'object_id',o.id,
  'object_version',o.version,'object_updated_at',o.updated_at,'object_name',m.object_name,
  'byte_size',m.byte_size,'mime_type',m.mime_type,'content_digest',m.content_digest);
END; $$;
CREATE FUNCTION public.creator_page_event_media_verification_binding(p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media; s public.creator_page_event_media; proof public.creator_page_event_media_verifications;
 source_object jsonb; destination_object jsonb;
BEGIN
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id;
 SELECT source.* INTO s FROM public.creator_page_event_media_reuse r JOIN public.creator_page_event_media source ON source.id=r.source_media_id WHERE r.media_id=p_media_id;
 IF m.id IS NULL OR s.id IS NULL OR s.ready_at IS NULL OR s.abandoned_at IS NOT NULL
 OR m.byte_size IS DISTINCT FROM s.byte_size OR m.mime_type IS DISTINCT FROM s.mime_type OR m.content_digest IS DISTINCT FROM s.content_digest
 THEN RAISE EXCEPTION 'Reuse source unavailable for verification' USING ERRCODE='PT409'; END IF;
 source_object:=public.creator_page_event_media_object_binding(s.id);
 destination_object:=public.creator_page_event_media_object_binding(m.id);
 -- A previously reused source must still be the exact separately confirmed object.
 IF EXISTS(SELECT 1 FROM public.creator_page_event_media_reuse WHERE media_id=s.id) THEN
  SELECT * INTO proof FROM public.creator_page_event_media_verifications WHERE media_id=s.id;
  IF proof.media_id IS NULL OR proof.binding->'destination' IS DISTINCT FROM source_object THEN RAISE EXCEPTION 'Source verification changed' USING ERRCODE='PT409'; END IF;
 END IF;
 RETURN jsonb_build_object('version',1,'user_id',m.created_by,'source',source_object,'destination',destination_object);
END; $$;
CREATE FUNCTION public.get_creator_page_event_media_verification(p_page_id uuid,p_event_id uuid,p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media;
BEGIN
 PERFORM public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id;
 IF m.id IS NULL OR m.ready_at IS NOT NULL THEN RAISE EXCEPTION 'Use the original media result' USING ERRCODE='PT409'; END IF;
 IF NOT coalesce(public.creator_page_event_media_reuse_allowed(m.id),false) THEN RAISE EXCEPTION 'Source media unavailable' USING ERRCODE='42501'; END IF;
 RETURN public.creator_page_event_media_verification_binding(m.id);
END; $$;
CREATE FUNCTION public.record_creator_page_event_media_verification(p_binding jsonb,p_raw_sha256 text,p_source_digest_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_media_id uuid; actual jsonb; proof public.creator_page_event_media_verifications;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Trusted verifier required' USING ERRCODE='42501'; END IF;
 IF p_binding IS NULL OR jsonb_typeof(p_binding)<>'object' OR p_raw_sha256 IS NULL OR p_raw_sha256 !~ '^[0-9a-f]{64}$'
 OR NOT coalesce(p_source_digest_kind IN('raw-sha256','native-md5-manifest-v1'),false) THEN RAISE EXCEPTION 'Invalid verification' USING ERRCODE='22023'; END IF;
 v_media_id:=(p_binding#>>'{destination,media_id}')::uuid;
 -- Identical lock order for proof recording and completion, including chained reuse.
 PERFORM 1 FROM public.creator_page_event_media WHERE id IN(v_media_id,(SELECT source_media_id FROM public.creator_page_event_media_reuse WHERE creator_page_event_media_reuse.media_id=v_media_id)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM storage.objects WHERE bucket_id='creator-event-media' AND name IN(
  SELECT object_name FROM public.creator_page_event_media WHERE id IN(v_media_id,(SELECT source_media_id FROM public.creator_page_event_media_reuse WHERE creator_page_event_media_reuse.media_id=v_media_id))) ORDER BY id FOR SHARE;
 actual:=public.creator_page_event_media_verification_binding(v_media_id);
 IF actual IS DISTINCT FROM p_binding OR (p_source_digest_kind='raw-sha256' AND p_raw_sha256 IS DISTINCT FROM actual#>>'{source,content_digest}') THEN RAISE EXCEPTION 'Verified media object changed' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.creator_page_event_media_verifications(media_id,binding,raw_sha256,source_digest_kind)
 VALUES(v_media_id,actual,p_raw_sha256,p_source_digest_kind) ON CONFLICT ON CONSTRAINT creator_page_event_media_verifications_pkey DO NOTHING;
 SELECT * INTO proof FROM public.creator_page_event_media_verifications v WHERE v.media_id=v_media_id;
 IF proof.binding IS DISTINCT FROM actual OR proof.raw_sha256 IS DISTINCT FROM p_raw_sha256 OR proof.source_digest_kind IS DISTINCT FROM p_source_digest_kind THEN RAISE EXCEPTION 'Use the original verification' USING ERRCODE='PT409'; END IF;
 RETURN jsonb_build_object('media_id',proof.media_id,'verified_at',proof.verified_at);
END; $$;
CREATE OR REPLACE FUNCTION public.complete_creator_page_event_media(p_page_id uuid,p_event_id uuid,p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media; o storage.objects; proof public.creator_page_event_media_verifications; reused boolean;
BEGIN
 PERFORM public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
 PERFORM 1 FROM public.creator_page_event_media WHERE id IN(p_media_id,(SELECT source_media_id FROM public.creator_page_event_media_reuse WHERE media_id=p_media_id)) ORDER BY id FOR UPDATE;
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id;
 IF m.id IS NULL OR m.abandoned_at IS NOT NULL THEN RAISE EXCEPTION 'Media attempt unavailable' USING ERRCODE='42501'; END IF;
 reused:=EXISTS(SELECT 1 FROM public.creator_page_event_media_reuse WHERE media_id=m.id);
 IF reused THEN
  PERFORM 1 FROM storage.objects WHERE bucket_id='creator-event-media' AND name IN(
   SELECT object_name FROM public.creator_page_event_media WHERE id IN(p_media_id,(SELECT source_media_id FROM public.creator_page_event_media_reuse WHERE media_id=p_media_id))) ORDER BY id FOR SHARE;
  IF m.ready_at IS NULL AND NOT coalesce(public.creator_page_event_media_reuse_allowed(m.id),false) THEN RAISE EXCEPTION 'Source media unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO proof FROM public.creator_page_event_media_verifications WHERE media_id=m.id;
  IF proof.media_id IS NULL THEN RAISE EXCEPTION 'Trusted byte verification required' USING ERRCODE='PT409'; END IF;
  IF m.ready_at IS NULL THEN
   IF NOT coalesce(public.creator_page_event_media_reuse_allowed(m.id),false) THEN RAISE EXCEPTION 'Source media unavailable' USING ERRCODE='42501'; END IF;
   IF proof.binding IS DISTINCT FROM public.creator_page_event_media_verification_binding(m.id) THEN RAISE EXCEPTION 'Verified source or destination changed' USING ERRCODE='PT409'; END IF;
  ELSIF proof.binding->'destination' IS DISTINCT FROM public.creator_page_event_media_object_binding(m.id) THEN
   RAISE EXCEPTION 'Confirmed destination changed' USING ERRCODE='PT409';
  END IF;
 END IF;
 IF m.ready_at IS NULL THEN
  IF NOT coalesce(public.creator_page_event_media_reuse_allowed(m.id),false) THEN RAISE EXCEPTION 'Source media unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM storage.objects WHERE bucket_id='creator-event-media' AND name=m.object_name;
  IF o.id IS NULL OR o.owner_id IS DISTINCT FROM m.created_by::text OR o.metadata->>'mimetype' IS DISTINCT FROM m.mime_type
  OR (o.metadata->>'size')::bigint IS DISTINCT FROM m.byte_size THEN RAISE EXCEPTION 'Upload has not been confirmed' USING ERRCODE='PT409'; END IF;
  UPDATE public.creator_page_event_media SET ready_at=now() WHERE id=m.id;
 END IF;
 RETURN public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
END; $$;
REVOKE ALL ON FUNCTION public.creator_page_event_media_object_binding(uuid),public.creator_page_event_media_verification_binding(uuid),public.get_creator_page_event_media_verification(uuid,uuid,uuid),public.record_creator_page_event_media_verification(jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_event_media_verification(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_creator_page_event_media_verification(jsonb,text,text) TO service_role;
COMMIT;
