-- Forward-only hardening for event-chat topic albums.
-- The client uploads JPEG photos and MP4 videos before registering each batch.
-- Enforce that exact wire behavior at both Storage and RPC boundaries so a
-- caller cannot register forged type/size metadata or upload another format.

BEGIN;

UPDATE storage.buckets
SET public = false,
    file_size_limit = 104857600,
    allowed_mime_types = ARRAY['image/jpeg', 'video/mp4']::text[]
WHERE id = 'topic-album-media';

DROP POLICY IF EXISTS "topic members can upload to topic-album-media" ON storage.objects;
CREATE POLICY "topic members can upload to topic-album-media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'topic-album-media'
    AND array_length(storage.foldername(name), 1) >= 3
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND lower(COALESCE(metadata->>'mimetype', '')) IN ('image/jpeg', 'video/mp4')
    AND COALESCE(NULLIF(metadata->>'size', '')::bigint, 0) > 0
    AND COALESCE(NULLIF(metadata->>'size', '')::bigint, 0) <= 104857600
    AND is_topic_member(((storage.foldername(name))[1])::uuid, auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.community_topics t
      WHERE t.id = ((storage.foldername(name))[1])::uuid
        AND t.album_enabled
        AND NOT t.archived
    )
  );

CREATE OR REPLACE FUNCTION public.start_topic_album_upload_batch(
  p_topic_id uuid,
  p_uploads jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_album_id uuid;
  v_upload jsonb;
  v_upload_id uuid;
  v_result uuid[] := ARRAY[]::uuid[];
  v_album_enabled boolean;
  v_archived boolean;
  v_path text;
  v_kind text;
  v_claimed_size bigint;
  v_actual_size bigint;
  v_actual_mime text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_uploads IS NULL OR jsonb_typeof(p_uploads) <> 'array'
     OR jsonb_array_length(p_uploads) = 0 OR jsonb_array_length(p_uploads) > 10 THEN
    RAISE EXCEPTION 'p_uploads must contain between 1 and 10 uploads' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT public.is_topic_member(p_topic_id, v_user_id) THEN
    RAISE EXCEPTION 'Not a member of this chat' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT t.album_enabled, t.archived
    INTO v_album_enabled, v_archived
  FROM public.community_topics t
  WHERE t.id = p_topic_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'topic not found' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT v_album_enabled OR v_archived THEN
    RAISE EXCEPTION 'topic album is not accepting uploads' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.community_topic_albums (topic_id)
  VALUES (p_topic_id)
  ON CONFLICT (topic_id) DO UPDATE SET topic_id = EXCLUDED.topic_id
  RETURNING id INTO v_album_id;

  FOR v_upload IN SELECT value FROM jsonb_array_elements(p_uploads)
  LOOP
    BEGIN
      v_upload_id := (v_upload->>'id')::uuid;
      v_claimed_size := (v_upload->>'file_size_bytes')::bigint;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'upload id and size must be valid' USING ERRCODE = 'invalid_parameter_value';
    END;

    v_path := v_upload->>'media_url';
    v_kind := v_upload->>'content_type';
    IF v_upload_id IS NULL OR v_path IS NULL OR v_kind NOT IN ('photo', 'video') THEN
      RAISE EXCEPTION 'upload id, media_url, and content_type are required' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF (string_to_array(v_path, '/'))[1] IS DISTINCT FROM p_topic_id::text
       OR (string_to_array(v_path, '/'))[2] IS DISTINCT FROM v_user_id::text
       OR (string_to_array(v_path, '/'))[3] IS DISTINCT FROM v_upload_id::text THEN
      RAISE EXCEPTION 'upload path does not match topic, caller, and upload id' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT
      lower(COALESCE(o.metadata->>'mimetype', '')),
      COALESCE(NULLIF(o.metadata->>'size', '')::bigint, 0)
      INTO v_actual_mime, v_actual_size
    FROM storage.objects o
    WHERE o.bucket_id = 'topic-album-media' AND o.name = v_path;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'uploaded object is missing' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_claimed_size <= 0 OR v_claimed_size > 104857600 OR v_actual_size <> v_claimed_size THEN
      RAISE EXCEPTION 'upload size metadata does not match Storage' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF (v_kind = 'photo' AND (v_actual_mime <> 'image/jpeg' OR v_actual_size > 15728640))
       OR (v_kind = 'video' AND (v_actual_mime <> 'video/mp4' OR v_actual_size > 104857600)) THEN
      RAISE EXCEPTION 'upload MIME type or size is not allowed' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.community_topic_album_uploads (
      id, topic_album_id, user_id, media_url, content_type, media_format,
      file_size_bytes, video_duration_sec
    ) VALUES (
      v_upload_id, v_album_id, v_user_id, v_path, v_kind,
      COALESCE(NULLIF(v_upload->>'media_format', ''), CASE WHEN v_kind = 'photo' THEN 'jpg' ELSE 'mp4' END),
      v_actual_size, NULLIF(v_upload->>'video_duration_sec', '')::integer
    )
    RETURNING id INTO v_upload_id;

    v_result := array_append(v_result, v_upload_id);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.start_topic_album_upload_batch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_topic_album_upload_batch(uuid, jsonb) TO authenticated;

DO $$
DECLARE
  v_limit bigint;
  v_types text[];
BEGIN
  SELECT file_size_limit, allowed_mime_types INTO v_limit, v_types
  FROM storage.buckets WHERE id = 'topic-album-media';
  IF v_limit <> 104857600
     OR NOT (v_types @> ARRAY['image/jpeg', 'video/mp4']::text[])
     OR cardinality(v_types) <> 2 THEN
    RAISE EXCEPTION 'topic-album-media bucket limits are not hardened';
  END IF;
  IF position('storage.objects' IN pg_get_functiondef('public.start_topic_album_upload_batch(uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'topic album RPC does not verify Storage metadata';
  END IF;
END $$;

COMMIT;
