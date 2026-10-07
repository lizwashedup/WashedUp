-- LOCAL / REVIEW ONLY. Terminal cancellation after source loss; no source grant.
BEGIN;
-- Reuse the media primary key, abandoned state and upload/attachment guards.
-- No source FK: this is caller-provided intent, not a verified source snapshot.
CREATE TABLE public.creator_page_event_media_cancellations (
 media_id uuid PRIMARY KEY REFERENCES public.creator_page_event_media(id),
 source_page_id uuid NOT NULL, source_event_id uuid NOT NULL, source_media_id uuid NOT NULL,
 CHECK(media_id<>source_media_id)
);
ALTER TABLE public.creator_page_event_media_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_event_media_cancellations FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_creator_page_event_media_reuse_attempt(p_page_id uuid,p_event_id uuid,p_media_id uuid,p_source_page_id uuid,p_source_event_id uuid,p_source_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt jsonb; s public.creator_page_event_media; cancelled public.creator_page_event_media_cancellations;
BEGIN
 receipt:=public.get_creator_page_event_media_attempt(p_page_id,p_event_id,p_media_id);
 IF receipt IS NULL THEN RETURN NULL; END IF;
 SELECT source.* INTO s FROM public.creator_page_event_media_reuse r JOIN public.creator_page_event_media source ON source.id=r.source_media_id WHERE r.media_id=p_media_id;
 IF s.id IS NULL THEN
  SELECT * INTO cancelled FROM public.creator_page_event_media_cancellations WHERE media_id=p_media_id;
  IF cancelled.media_id IS NOT NULL AND cancelled.source_page_id=p_source_page_id
   AND cancelled.source_event_id=p_source_event_id AND cancelled.source_media_id=p_source_media_id
   AND receipt->>'abandoned_at' IS NOT NULL THEN
   -- Only the original caller-provided identity; never inspect a private source.
   RETURN receipt||jsonb_build_object('source_media_id',cancelled.source_media_id,
    'source_page_id',cancelled.source_page_id,'source_event_id',cancelled.source_event_id,
    'source_object_name',cancelled.source_event_id::text||'/private-'||cancelled.source_media_id::text||
     CASE receipt->>'mime_type' WHEN 'video/mp4' THEN '.mp4' WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END);
  END IF;
 END IF;
 IF s.id IS NULL OR s.id IS DISTINCT FROM p_source_media_id OR s.page_id IS DISTINCT FROM p_source_page_id OR s.event_id IS DISTINCT FROM p_source_event_id THEN
  RAISE EXCEPTION 'Use the original media reuse attempt' USING ERRCODE='22023'; END IF;
 -- Original actor may inspect their own pending/terminal attempt after source
 -- revocation; this does not grant source bytes or permission to resume copying.
 RETURN receipt||jsonb_build_object('source_media_id',s.id,'source_page_id',s.page_id,'source_event_id',s.event_id,'source_object_name',s.object_name);
END;
$$;
CREATE FUNCTION public.cancel_creator_page_event_media_reuse(p_page_id uuid,p_event_id uuid,p_media_id uuid,p_purpose text,p_byte_size bigint,p_mime_type text,p_content_digest text,p_source_page_id uuid,p_source_event_id uuid,p_source_media_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.creator_page_event_media; inserted uuid; receipt jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 -- Same event lock as reservation/publication. A terminal cleanup also works
 -- when the saved destination has since closed; it never modifies the event.
 PERFORM 1 FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 IF p_media_id IS NULL OR p_source_page_id IS NULL OR p_source_event_id IS NULL OR p_source_media_id IS NULL OR p_media_id=p_source_media_id
 OR p_content_digest IS NULL OR p_content_digest !~ '^[0-9a-f]{64}$' OR NOT coalesce(
 (p_purpose='video' AND p_mime_type='video/mp4' AND p_byte_size BETWEEN 1 AND 104857600) OR
 (p_purpose IN('cover','image','poster') AND p_mime_type IN('image/jpeg','image/png','image/webp') AND p_byte_size BETWEEN 1 AND 10485760),false)
 THEN RAISE EXCEPTION 'Check the original media reuse' USING ERRCODE='22023'; END IF;
 INSERT INTO public.creator_page_event_media(id,page_id,event_id,created_by,purpose,object_name,byte_size,mime_type,content_digest,abandoned_at)
 VALUES(p_media_id,p_page_id,p_event_id,auth.uid(),p_purpose,p_event_id::text||'/private-'||p_media_id::text||CASE p_mime_type WHEN 'video/mp4' THEN '.mp4' WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END,p_byte_size,p_mime_type,p_content_digest,now())
 ON CONFLICT(id) DO NOTHING RETURNING id INTO inserted;
 IF inserted IS NOT NULL THEN
  INSERT INTO public.creator_page_event_media_cancellations(media_id,source_page_id,source_event_id,source_media_id)
  VALUES(p_media_id,p_source_page_id,p_source_event_id,p_source_media_id);
 END IF;
 SELECT * INTO m FROM public.creator_page_event_media WHERE id=p_media_id;
 IF m.page_id IS DISTINCT FROM p_page_id OR m.event_id IS DISTINCT FROM p_event_id OR m.created_by IS DISTINCT FROM auth.uid()
 OR m.purpose IS DISTINCT FROM p_purpose OR m.byte_size IS DISTINCT FROM p_byte_size OR m.mime_type IS DISTINCT FROM p_mime_type OR m.content_digest IS DISTINCT FROM p_content_digest
 THEN RAISE EXCEPTION 'Use the original media reuse attempt' USING ERRCODE='22023'; END IF;
 -- A real existing reuse must match its verified original source. An ordinary
 -- upload cannot be adopted. Both checks roll back any unsuccessful insertion.
 receipt:=public.get_creator_page_event_media_reuse_attempt(p_page_id,p_event_id,p_media_id,p_source_page_id,p_source_event_id,p_source_media_id);
 IF NOT (receipt->>'attached')::boolean THEN
  PERFORM public.abandon_creator_page_event_media(p_page_id,p_event_id,p_media_id);
 END IF;
 RETURN public.get_creator_page_event_media_reuse_attempt(p_page_id,p_event_id,p_media_id,p_source_page_id,p_source_event_id,p_source_media_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_creator_page_event_media_reuse(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_creator_page_event_media_reuse(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid,uuid) TO authenticated;
COMMIT;
