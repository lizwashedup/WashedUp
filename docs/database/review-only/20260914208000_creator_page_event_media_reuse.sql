-- LOCAL / REVIEW ONLY. Preserve the original media while reserving a separately
-- authorized destination for Make cover and event/template reuse. No Storage copy grant.
BEGIN;
CREATE TABLE public.creator_page_event_media_reuse (
 media_id uuid PRIMARY KEY REFERENCES public.creator_page_event_media(id),
 source_media_id uuid NOT NULL REFERENCES public.creator_page_event_media(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(media_id<>source_media_id)
);
ALTER TABLE public.creator_page_event_media_reuse ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_event_media_reuse FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_creator_page_event_media_source(p_page_id uuid,p_event_id uuid,p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Source event unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id AND page_id=p_page_id AND event_id=p_event_id;
 IF m.id IS NULL OR m.ready_at IS NULL OR m.abandoned_at IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM storage.objects o WHERE o.bucket_id='creator-event-media' AND o.name=m.object_name
  AND o.owner_id=m.created_by::text AND o.metadata->>'mimetype'=m.mime_type AND (o.metadata->>'size')::bigint=m.byte_size
 ) THEN RAISE EXCEPTION 'Source media unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('media_id',m.id,'page_id',m.page_id,'event_id',m.event_id,'object_name',m.object_name,
  'purpose',m.purpose,'byte_size',m.byte_size,'mime_type',m.mime_type,'content_digest',m.content_digest);
END;
$$;
CREATE FUNCTION public.creator_page_event_media_reuse_allowed(p_media_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.creator_page_event_media_reuse WHERE media_id=p_media_id) OR EXISTS(
 SELECT 1 FROM public.creator_page_event_media_reuse r JOIN public.creator_page_event_media s ON s.id=r.source_media_id
 JOIN storage.objects o ON o.bucket_id='creator-event-media' AND o.name=s.object_name
 WHERE r.media_id=p_media_id AND s.ready_at IS NOT NULL AND s.abandoned_at IS NULL
 AND o.owner_id=s.created_by::text AND o.metadata->>'mimetype'=s.mime_type AND (o.metadata->>'size')::bigint=s.byte_size
 AND public.creator_page_event_save_access(s.page_id,s.event_id));
$$;
CREATE FUNCTION public.get_creator_page_event_media_reuse_attempt(p_page_id uuid,p_event_id uuid,p_media_id uuid,p_source_page_id uuid,p_source_event_id uuid,p_source_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb; s public.creator_page_event_media;
BEGIN
 receipt:=public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
 IF receipt IS NULL THEN RETURN NULL; END IF;
 SELECT source.* INTO s FROM public.creator_page_event_media_reuse r JOIN public.creator_page_event_media source ON source.id=r.source_media_id WHERE r.media_id=p_media_id;
 IF s.id IS NULL OR s.id IS DISTINCT FROM p_source_media_id OR s.page_id IS DISTINCT FROM p_source_page_id OR s.event_id IS DISTINCT FROM p_source_event_id THEN
  RAISE EXCEPTION 'Use the original media reuse attempt' USING ERRCODE='22023'; END IF;
 -- Original actor may inspect their own pending/terminal attempt after source
 -- revocation; this does not grant source bytes or permission to resume copying.
 RETURN receipt||jsonb_build_object('source_media_id',s.id,'source_page_id',s.page_id,'source_event_id',s.event_id,'source_object_name',s.object_name);
END;
$$;
CREATE FUNCTION public.reserve_creator_page_event_media_reuse(p_page_id uuid,p_event_id uuid,p_media_id uuid,p_purpose text,p_source_page_id uuid,p_source_event_id uuid,p_source_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.creator_page_event_media; m public.creator_page_event_media; inserted uuid; v_status text;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 SELECT status::text INTO v_status FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF v_status NOT IN('Draft','Live') OR NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event is unavailable for media' USING ERRCODE='42501'; END IF;
 -- Both exact page capabilities are checked by the backend, including retries.
 PERFORM public.get_creator_page_event_media_source(p_source_page_id,p_source_event_id,p_source_media_id);
 SELECT * INTO s FROM public.creator_page_event_media WHERE id=p_source_media_id;
 IF p_media_id IS NULL OR p_media_id=p_source_media_id OR NOT coalesce(
  (p_purpose='video' AND s.mime_type='video/mp4') OR (p_purpose IN('cover','image','poster') AND s.mime_type IN('image/jpeg','image/png','image/webp')),false)
 THEN RAISE EXCEPTION 'Check this media reuse' USING ERRCODE='22023'; END IF;
 INSERT INTO public.creator_page_event_media(id,page_id,event_id,created_by,purpose,object_name,byte_size,mime_type,content_digest)
 VALUES(p_media_id,p_page_id,p_event_id,auth.uid(),p_purpose,p_event_id::text||'/private-'||p_media_id::text||CASE s.mime_type WHEN 'video/mp4' THEN '.mp4' WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END,s.byte_size,s.mime_type,s.content_digest)
 ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NOT NULL THEN
  INSERT INTO public.creator_page_event_media_reuse(media_id,source_media_id) VALUES(p_media_id,p_source_media_id);
 END IF;
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id;
 IF m.page_id IS DISTINCT FROM p_page_id OR m.event_id IS DISTINCT FROM p_event_id OR m.created_by IS DISTINCT FROM auth.uid()
 OR m.purpose IS DISTINCT FROM p_purpose OR m.byte_size IS DISTINCT FROM s.byte_size OR m.mime_type IS DISTINCT FROM s.mime_type OR m.content_digest IS DISTINCT FROM s.content_digest
 THEN RAISE EXCEPTION 'Use the original media reuse attempt' USING ERRCODE='22023'; END IF;
 -- An ordinary upload ID is never retroactively adopted, even in an insert race.
 RETURN public.get_creator_page_event_media_reuse_attempt(p_page_id,p_event_id,p_media_id,p_source_page_id,p_source_event_id,p_source_media_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.creator_page_event_media_can_upload(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_event_media m JOIN public.explore_events e ON e.id=m.event_id
 WHERE m.object_name=p_name AND m.created_by=auth.uid() AND m.ready_at IS NULL AND m.abandoned_at IS NULL
 AND e.status IN('Draft','Live') AND public.creator_page_event_save_access(m.page_id,m.event_id)
 AND public.creator_page_event_media_reuse_allowed(m.id));
$$;
CREATE OR REPLACE FUNCTION public.complete_creator_page_event_media(p_page_id uuid,p_event_id uuid,p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media; o storage.objects;
BEGIN
 PERFORM public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id FOR UPDATE;
 IF m.id IS NULL OR m.abandoned_at IS NOT NULL THEN RAISE EXCEPTION 'Media attempt unavailable' USING ERRCODE='42501'; END IF;
 IF m.ready_at IS NULL THEN
  IF NOT coalesce(public.creator_page_event_media_reuse_allowed(m.id),false) THEN RAISE EXCEPTION 'Source media unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO o FROM storage.objects WHERE bucket_id='creator-event-media' AND name=m.object_name;
  IF o.id IS NULL OR o.owner_id IS DISTINCT FROM m.created_by::text OR (o.metadata->>'mimetype') IS DISTINCT FROM m.mime_type
  OR (o.metadata->>'size')::bigint IS DISTINCT FROM m.byte_size THEN RAISE EXCEPTION 'Upload has not been confirmed' USING ERRCODE='PT409'; END IF;
  UPDATE public.creator_page_event_media SET ready_at=now() WHERE id=m.id;
 END IF;
 RETURN public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_event_media_source(uuid,uuid,uuid),public.creator_page_event_media_reuse_allowed(uuid),public.get_creator_page_event_media_reuse_attempt(uuid,uuid,uuid,uuid,uuid,uuid),public.reserve_creator_page_event_media_reuse(uuid,uuid,uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_event_media_source(uuid,uuid,uuid),public.get_creator_page_event_media_reuse_attempt(uuid,uuid,uuid,uuid,uuid,uuid),public.reserve_creator_page_event_media_reuse(uuid,uuid,uuid,text,uuid,uuid,uuid) TO authenticated;
COMMIT;
