-- LOCAL / REVIEW ONLY: private immutable page covers, with authenticated reads.
-- Depends on the per-page review/publication candidates. No legacy media changes.
BEGIN;
CREATE TABLE public.creator_page_media (
 id uuid PRIMARY KEY,
 page_id uuid NOT NULL, -- survives private-draft cleanup for published page history
 object_name text NOT NULL UNIQUE,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 8388608),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png')),
 created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz,
 CHECK(object_name=page_id::text||'/'||id::text||CASE mime_type WHEN 'image/jpeg' THEN '.jpg' ELSE '.png' END)
);
CREATE INDEX creator_page_media_page ON public.creator_page_media(page_id);
CREATE TABLE public.creator_page_cover_publications (
 page_id uuid PRIMARY KEY REFERENCES public.creator_page_publications(page_id) ON DELETE CASCADE,
 media_id uuid NOT NULL REFERENCES public.creator_page_media(id) ON DELETE RESTRICT
);
REVOKE ALL ON public.creator_page_media,public.creator_page_cover_publications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.creator_page_media,public.creator_page_cover_publications TO anon,authenticated;
ALTER TABLE public.creator_page_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_page_cover_publications ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.creator_page_media_can_read(p_object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_media m WHERE m.object_name=p_object_name AND (
  (m.created_by=auth.uid() AND public.creator_page_is_owned(m.page_id)) OR public.is_admin(auth.uid())
  OR (m.ready_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.creator_page_cover_publications c
   WHERE c.media_id=m.id AND c.page_id=m.page_id AND public.creator_page_is_visible(c.page_id)))
 ));
$$;
CREATE FUNCTION public.creator_page_media_can_upload(p_object_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_media m WHERE m.object_name=p_object_name
 AND m.created_by=auth.uid() AND m.ready_at IS NULL AND public.creator_page_is_owned(m.page_id));
$$;
REVOKE ALL ON FUNCTION public.creator_page_media_can_read(text),public.creator_page_media_can_upload(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_page_media_can_read(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.creator_page_media_can_upload(text) TO anon,authenticated;
CREATE POLICY creator_page_media_read ON public.creator_page_media FOR SELECT
 USING(public.creator_page_media_can_read(object_name));
CREATE POLICY creator_page_cover_publication_read ON public.creator_page_cover_publications FOR SELECT
 USING(public.creator_page_is_visible(page_id));

CREATE FUNCTION public.reserve_creator_page_media(p_page_id uuid,p_media_id uuid,p_byte_size integer,p_mime_type text)
RETURNS public.creator_page_media LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_media;
BEGIN
 IF auth.uid() IS NULL OR NOT public.creator_page_is_owned(p_page_id) THEN
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
CREATE FUNCTION public.complete_creator_page_media(p_page_id uuid,p_media_id uuid)
RETURNS public.creator_page_media LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_media; o storage.objects;
BEGIN
 IF auth.uid() IS NULL OR NOT public.creator_page_is_owned(p_page_id) THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.creator_page_media WHERE id=p_media_id AND page_id=p_page_id FOR UPDATE;
 IF m.id IS NULL OR m.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Image unavailable' USING ERRCODE='42501'; END IF;
 IF m.ready_at IS NOT NULL THEN RETURN m; END IF;
 SELECT * INTO o FROM storage.objects WHERE bucket_id='creator-page-media' AND name=m.object_name;
 IF o.id IS NULL OR o.owner_id IS DISTINCT FROM auth.uid()::text
 OR (o.metadata->>'mimetype') IS DISTINCT FROM m.mime_type
 OR (o.metadata->>'size')::bigint IS DISTINCT FROM m.byte_size::bigint THEN
  RAISE EXCEPTION 'The image upload has not been confirmed' USING ERRCODE='PT409'; END IF;
 UPDATE public.creator_page_media SET ready_at=now() WHERE id=m.id RETURNING * INTO m;
 RETURN m;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_creator_page_media(uuid,uuid,integer,text),public.complete_creator_page_media(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_creator_page_media(uuid,uuid,integer,text),public.complete_creator_page_media(uuid,uuid) TO authenticated;

CREATE FUNCTION public.creator_page_validate_cover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.page_data ? 'cover_media_id' AND NEW.page_data->'cover_media_id'<>'null'::jsonb THEN
  IF jsonb_typeof(NEW.page_data->'cover_media_id')<>'string' OR NOT EXISTS(
   SELECT 1 FROM public.creator_page_media m WHERE m.id::text=NEW.page_data->>'cover_media_id'
    AND m.page_id=NEW.id AND m.created_by=NEW.owner_id AND m.ready_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Confirm this page cover before saving' USING ERRCODE='22023'; END IF;
  IF nullif(NEW.page_data->>'photo_url','') IS NOT NULL THEN
   RAISE EXCEPTION 'A private cover cannot also use a public image URL' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER creator_page_draft_cover BEFORE INSERT OR UPDATE OF page_data ON public.creator_page_drafts
 FOR EACH ROW EXECUTE FUNCTION public.creator_page_validate_cover();
CREATE FUNCTION public.creator_page_publish_cover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_media_id uuid;
BEGIN
 SELECT m.id INTO v_media_id FROM public.creator_page_submissions s JOIN public.creator_page_media m
 ON m.id::text=s.page_snapshot->>'cover_media_id' AND m.page_id=s.page_id AND m.ready_at IS NOT NULL
 WHERE s.id=NEW.submission_id AND s.page_id=NEW.page_id AND s.status='approved';
 IF v_media_id IS NOT NULL THEN
  INSERT INTO public.creator_page_cover_publications(page_id,media_id) VALUES(NEW.page_id,v_media_id);
  IF NEW.page_kind='community' THEN
   UPDATE public.community_blocks SET content=jsonb_build_object('images','[]'::jsonb,'cover_media_id',v_media_id)
   WHERE community_id=NEW.page_id AND block_type='cover';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER creator_page_publish_cover AFTER INSERT ON public.creator_page_publications
 FOR EACH ROW EXECUTE FUNCTION public.creator_page_publish_cover();
REVOKE ALL ON FUNCTION public.creator_page_validate_cover(),public.creator_page_publish_cover() FROM PUBLIC,anon,authenticated,service_role;

-- The existing community-media bucket and all historical policies remain unchanged.
-- Restrictive guards keep future permissive legacy policies from opening this bucket.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('creator-page-media','creator-page-media',false,8388608,ARRAY['image/jpeg','image/png']);
CREATE POLICY creator_cover_select ON storage.objects FOR SELECT TO anon,authenticated
 USING(bucket_id='creator-page-media' AND public.creator_page_media_can_read(name));
CREATE POLICY creator_cover_read_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(bucket_id<>'creator-page-media' OR (
  (storage.allow_only_operation('object.get_authenticated') OR storage.allow_only_operation('object.get_authenticated_info') OR storage.allow_only_operation('object.head_authenticated_info'))
  AND public.creator_page_media_can_read(name)));
CREATE POLICY creator_cover_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='creator-page-media' AND public.creator_page_media_can_upload(name));
CREATE POLICY creator_cover_write_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated
 WITH CHECK(bucket_id<>'creator-page-media' OR (storage.allow_only_operation('object.upload') AND public.creator_page_media_can_upload(name)));
CREATE POLICY creator_cover_no_overwrite ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
 USING(bucket_id<>'creator-page-media') WITH CHECK(bucket_id<>'creator-page-media');
CREATE POLICY creator_cover_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated
 USING(bucket_id<>'creator-page-media');
COMMIT;
