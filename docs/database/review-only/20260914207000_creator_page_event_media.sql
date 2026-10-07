-- LOCAL / REVIEW ONLY. Private immutable page-event media and original-attempt recovery.
-- New writers/readers must be integrated before enabling the release flag.
BEGIN;
-- Never reinterpret an existing legacy media name as a new protected reference.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.explore_events e WHERE e.image_url LIKE 'creator-event-media:%'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.description_blocks)='array' THEN e.description_blocks ELSE '[]'::jsonb END) b
 WHERE b->>'path' LIKE '%/private-%' OR b->>'poster' LIKE '%/private-%')) THEN
 RAISE EXCEPTION 'Existing private media references require reconciliation before activation' USING ERRCODE='55000'; END IF;
END; $$;
CREATE TABLE public.creator_page_event_media (
 id uuid PRIMARY KEY, page_id uuid NOT NULL, event_id uuid NOT NULL, created_by uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('cover','image','video','poster')),
 object_name text NOT NULL UNIQUE, byte_size bigint NOT NULL, mime_type text NOT NULL,
 content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, abandoned_at timestamptz,
 CHECK((purpose='video' AND mime_type='video/mp4' AND byte_size BETWEEN 1 AND 104857600)
  OR (purpose IN('cover','image','poster') AND mime_type IN('image/jpeg','image/png','image/webp') AND byte_size BETWEEN 1 AND 10485760)),
 CHECK(object_name=event_id::text||'/private-'||id::text||CASE mime_type WHEN 'video/mp4' THEN '.mp4' WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END)
);
ALTER TABLE public.creator_page_event_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_event_media FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX creator_page_event_media_event ON public.creator_page_event_media(event_id,created_by);
CREATE FUNCTION public.creator_page_event_media_attached(p_media_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_event_media m JOIN public.explore_events e ON e.id=m.event_id
 WHERE m.id=p_media_id AND (e.image_url='creator-event-media:'||m.object_name OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.description_blocks)='array' THEN e.description_blocks ELSE '[]'::jsonb END) b
  WHERE b->>'path'=m.object_name OR b->>'poster'=m.object_name)));
$$;
CREATE FUNCTION public.creator_page_event_media_can_read(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_event_media m WHERE m.object_name=p_name AND (
  public.creator_page_event_save_access(m.page_id,m.event_id) OR
  (m.ready_at IS NOT NULL AND m.abandoned_at IS NULL AND public.creator_page_event_media_attached(m.id)
   AND public.creator_event_is_visible(m.event_id))));
$$;
CREATE FUNCTION public.creator_page_event_media_can_upload(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_event_media m JOIN public.explore_events e ON e.id=m.event_id
 WHERE m.object_name=p_name AND m.created_by=auth.uid() AND m.ready_at IS NULL AND m.abandoned_at IS NULL
 AND e.status IN('Draft','Live') AND public.creator_page_event_save_access(m.page_id,m.event_id));
$$;
CREATE FUNCTION public.get_creator_page_event_media_attempt(p_page_id uuid,p_event_id uuid,p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id;
 IF m.id IS NULL THEN RETURN NULL; END IF;
 IF m.page_id<>p_page_id OR m.event_id<>p_event_id OR m.created_by<>auth.uid() THEN RAISE EXCEPTION 'Media attempt unavailable' USING ERRCODE='42501'; END IF;
 RETURN to_jsonb(m)||jsonb_build_object('object_present',EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='creator-event-media' AND name=m.object_name),'attached',public.creator_page_event_media_attached(m.id));
END;
$$;
CREATE FUNCTION public.reserve_creator_page_event_media(p_page_id uuid,p_event_id uuid,p_media_id uuid,p_purpose text,p_byte_size bigint,p_mime_type text,p_content_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media; v_status text;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 SELECT status::text INTO v_status FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF v_status NOT IN('Draft','Live') OR NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event is unavailable for media' USING ERRCODE='42501'; END IF;
 IF p_media_id IS NULL OR p_content_digest IS NULL OR p_content_digest !~ '^[0-9a-f]{64}$' OR NOT coalesce(
 (p_purpose='video' AND p_mime_type='video/mp4' AND p_byte_size BETWEEN 1 AND 104857600) OR
 (p_purpose IN('cover','image','poster') AND p_mime_type IN('image/jpeg','image/png','image/webp') AND p_byte_size BETWEEN 1 AND 10485760),false) THEN RAISE EXCEPTION 'Check this media file' USING ERRCODE='22023'; END IF;
 INSERT INTO public.creator_page_event_media(id,page_id,event_id,created_by,purpose,object_name,byte_size,mime_type,content_digest)
 VALUES(p_media_id,p_page_id,p_event_id,auth.uid(),p_purpose,p_event_id::text||'/private-'||p_media_id::text||CASE p_mime_type WHEN 'video/mp4' THEN '.mp4' WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END,p_byte_size,p_mime_type,p_content_digest)
 ON CONFLICT(id) DO NOTHING;
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id;
 IF m.page_id<>p_page_id OR m.event_id<>p_event_id OR m.created_by<>auth.uid() OR m.purpose<>p_purpose OR m.byte_size<>p_byte_size OR m.mime_type<>p_mime_type OR m.content_digest<>p_content_digest THEN RAISE EXCEPTION 'Use the original media attempt' USING ERRCODE='22023'; END IF;
 RETURN public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
END;
$$;
CREATE FUNCTION public.complete_creator_page_event_media(p_page_id uuid,p_event_id uuid,p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media; o storage.objects;
BEGIN
 PERFORM public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id FOR UPDATE;
 IF m.id IS NULL OR m.abandoned_at IS NOT NULL THEN RAISE EXCEPTION 'Media attempt unavailable' USING ERRCODE='42501'; END IF;
 IF m.ready_at IS NULL THEN
  SELECT * INTO o FROM storage.objects WHERE bucket_id='creator-event-media' AND name=m.object_name;
  IF o.id IS NULL OR o.owner_id IS DISTINCT FROM m.created_by::text OR (o.metadata->>'mimetype') IS DISTINCT FROM m.mime_type
  OR (o.metadata->>'size')::bigint IS DISTINCT FROM m.byte_size THEN RAISE EXCEPTION 'Upload has not been confirmed' USING ERRCODE='PT409'; END IF;
  UPDATE public.creator_page_event_media SET ready_at=now() WHERE id=m.id;
 END IF;
 RETURN public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
END;
$$;
CREATE FUNCTION public.abandon_creator_page_event_media(p_page_id uuid,p_event_id uuid,p_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
 PERFORM 1 FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF public.creator_page_event_media_attached(p_media_id) THEN RAISE EXCEPTION 'This media is attached to the event' USING ERRCODE='PT409'; END IF;
 UPDATE public.creator_page_event_media SET abandoned_at=coalesce(abandoned_at,now()) WHERE id=p_media_id AND page_id=p_page_id AND event_id=p_event_id AND created_by=auth.uid();
 RETURN public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
END;
$$;
-- A reservation is not publication. Only ready, non-abandoned media may enter the saved event.
CREATE FUNCTION public.creator_page_event_validate_media() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ref text; expected text; b jsonb;
BEGIN
 IF NEW.image_url LIKE 'creator-event-media:%' THEN
  ref:=substr(NEW.image_url,length('creator-event-media:')+1);
  IF NOT EXISTS(SELECT 1 FROM public.creator_page_event_media m WHERE m.event_id=NEW.id AND m.object_name=ref AND m.purpose='cover' AND m.ready_at IS NOT NULL AND m.abandoned_at IS NULL) THEN RAISE EXCEPTION 'Cover upload is not confirmed for this event' USING ERRCODE='22023'; END IF;
 END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.description_blocks)='array' THEN NEW.description_blocks ELSE '[]'::jsonb END) LOOP
  FOREACH expected IN ARRAY ARRAY['path','poster'] LOOP
   ref:=b->>expected;
   IF ref LIKE '%/private-%' THEN
    IF NOT EXISTS(SELECT 1 FROM public.creator_page_event_media m WHERE m.event_id=NEW.id AND m.object_name=ref
     AND m.purpose=CASE WHEN expected='poster' THEN 'poster' ELSE b->>'type' END AND m.ready_at IS NOT NULL AND m.abandoned_at IS NULL) THEN RAISE EXCEPTION 'Media upload is not confirmed for this event' USING ERRCODE='22023'; END IF;
   END IF;
  END LOOP;
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE TRIGGER creator_page_event_media_validation BEFORE INSERT OR UPDATE OF image_url,description_blocks ON public.explore_events FOR EACH ROW EXECUTE FUNCTION public.creator_page_event_validate_media();
REVOKE ALL ON FUNCTION public.creator_page_event_media_attached(uuid),public.creator_page_event_media_can_read(text),public.creator_page_event_media_can_upload(text),public.get_creator_page_event_media_attempt(uuid,uuid,uuid),public.reserve_creator_page_event_media(uuid,uuid,uuid,text,bigint,text,text),public.complete_creator_page_event_media(uuid,uuid,uuid),public.abandon_creator_page_event_media(uuid,uuid,uuid),public.creator_page_event_validate_media() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_page_event_media_can_read(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.creator_page_event_media_can_upload(text),public.get_creator_page_event_media_attempt(uuid,uuid,uuid),public.reserve_creator_page_event_media(uuid,uuid,uuid,text,bigint,text,text),public.complete_creator_page_event_media(uuid,uuid,uuid),public.abandon_creator_page_event_media(uuid,uuid,uuid) TO authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('creator-event-media','creator-event-media',false,104857600,ARRAY['image/jpeg','image/png','image/webp','video/mp4']);
CREATE POLICY creator_event_media_select ON storage.objects FOR SELECT TO anon,authenticated USING(bucket_id='creator-event-media' AND public.creator_page_event_media_can_read(name));
CREATE POLICY creator_event_media_read_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(bucket_id<>'creator-event-media' OR ((storage.allow_only_operation('object.get_authenticated') OR storage.allow_only_operation('object.get_authenticated_info') OR storage.allow_only_operation('object.head_authenticated_info')) AND public.creator_page_event_media_can_read(name)));
CREATE POLICY creator_event_media_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='creator-event-media' AND public.creator_page_event_media_can_upload(name));
CREATE POLICY creator_event_media_write_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(bucket_id<>'creator-event-media' OR (storage.allow_only_operation('object.upload') AND public.creator_page_event_media_can_upload(name)));
CREATE POLICY creator_event_media_no_overwrite ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'creator-event-media') WITH CHECK(bucket_id<>'creator-event-media');
CREATE POLICY creator_event_media_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id<>'creator-event-media');
COMMIT;
