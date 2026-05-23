-- Album upgrade Phase 3: add aspect-ratio + chronological-sort fields to
-- album_uploads, and persist them via start_album_upload_batch.
--
-- Scope of this migration (the ENTIRE file):
--   1. ALTER TABLE album_uploads: add 3 nullable columns (taken_at, width, height).
--   2. CREATE OR REPLACE start_album_upload_batch: same function as live, with
--      the new columns added to the INSERT (read from the upload jsonb via
--      NULLIF so payloads without them store NULL).
-- No indexes, no RLS changes, no other tables, no data backfill.

-- 1. New columns (nullable; existing rows + old clients leave them NULL).
ALTER TABLE public.album_uploads
  ADD COLUMN IF NOT EXISTS taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer;

-- 2. Persist the new fields from the upload jsonb. Only the INSERT column list
--    and VALUES differ from the currently-deployed function; everything else is
--    byte-identical to prod.
CREATE OR REPLACE FUNCTION public.start_album_upload_batch(p_event_id uuid, p_uploads jsonb, p_visible_to_user_ids uuid[], p_marketing_consent boolean, p_instagram text, p_tiktok text, p_testimonial text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_album_id uuid;
  v_existing_photo_count int; v_existing_video_count int;
  v_new_photo_count int; v_new_video_count int;
  v_upload jsonb; v_upload_id uuid; v_result uuid[] := ARRAY[]::uuid[];
  v_visible_uid uuid; v_path_parts text[];
  v_event_status text; v_event_member_count int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_uploads IS NULL OR jsonb_typeof(p_uploads) <> 'array' OR jsonb_array_length(p_uploads) = 0 THEN
    RAISE EXCEPTION 'p_uploads must be a non-empty JSON array';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_event_id::text || ':' || v_user_id::text));

  IF NOT EXISTS (SELECT 1 FROM event_members em
                 WHERE em.event_id = p_event_id AND em.user_id = v_user_id AND em.status = 'joined') THEN
    RAISE EXCEPTION 'not a joined member of event %', p_event_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM plan_attendance pa
             WHERE pa.event_id = p_event_id AND pa.user_id = v_user_id AND pa.was_present = false) THEN
    RAISE EXCEPTION 'marked not-present, cannot upload to album' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status::text, COALESCE(member_count, 0) INTO v_event_status, v_event_member_count
  FROM events WHERE id = p_event_id;

  IF v_event_status = 'cancelled' THEN
    RAISE EXCEPTION 'plan is cancelled, album uploads are closed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_event_member_count < 2 THEN
    RAISE EXCEPTION 'plan has fewer than 2 joined members, album uploads are closed' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO plan_albums (event_id, status, first_upload_at)
  VALUES (p_event_id, 'ready', now())
  ON CONFLICT (event_id) DO UPDATE
    SET status = CASE WHEN plan_albums.first_upload_at IS NULL THEN 'ready' ELSE plan_albums.status END,
        first_upload_at = COALESCE(plan_albums.first_upload_at, now())
  RETURNING id INTO v_album_id;

  SELECT COUNT(*) FILTER (WHERE content_type = 'photo'), COUNT(*) FILTER (WHERE content_type = 'video')
  INTO v_existing_photo_count, v_existing_video_count
  FROM album_uploads WHERE plan_album_id = v_album_id AND user_id = v_user_id AND deleted_at IS NULL;

  SELECT COUNT(*) FILTER (WHERE u->>'content_type' = 'photo'), COUNT(*) FILTER (WHERE u->>'content_type' = 'video')
  INTO v_new_photo_count, v_new_video_count
  FROM jsonb_array_elements(p_uploads) AS u;

  IF (v_existing_photo_count + v_new_photo_count) > 20 THEN
    RAISE EXCEPTION 'photo cap exceeded (20 max per album per person)' USING ERRCODE = 'check_violation';
  END IF;
  IF (v_existing_video_count + v_new_video_count) > 6 THEN
    RAISE EXCEPTION 'video cap exceeded (6 max per album per person)' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_upload IN SELECT * FROM jsonb_array_elements(p_uploads) LOOP
    IF (v_upload->>'id') IS NULL THEN RAISE EXCEPTION 'each upload must include an id (uuid)'; END IF;
    v_path_parts := string_to_array(v_upload->>'media_url', '/');
    IF v_path_parts IS NULL OR array_length(v_path_parts, 1) < 4 THEN
      RAISE EXCEPTION 'media_url must have at least 4 segments: {event_id}/{user_id}/{upload_id}/{filename}';
    END IF;
    IF v_path_parts[3] <> (v_upload->>'id') THEN RAISE EXCEPTION 'media_url path[3] must equal the upload id'; END IF;
    IF v_path_parts[1] <> p_event_id::text THEN RAISE EXCEPTION 'media_url path[1] must equal the event id'; END IF;
    IF v_path_parts[2] <> v_user_id::text THEN RAISE EXCEPTION 'media_url path[2] must equal the caller user id'; END IF;
    IF (v_upload->>'content_type') = 'video' AND (NULLIF(v_upload->>'video_duration_sec', '') IS NULL) THEN
      RAISE EXCEPTION 'video_duration_sec is required for videos and must be 1..60 seconds' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO album_uploads (
      id, plan_album_id, user_id, media_url, content_type, media_format,
      file_size_bytes, video_duration_sec, marketing_consent, instagram_handle, tiktok_handle, testimonial_text,
      width, height, taken_at)
    VALUES (
      (v_upload->>'id')::uuid, v_album_id, v_user_id,
      v_upload->>'media_url', v_upload->>'content_type', v_upload->>'media_format',
      (v_upload->>'file_size_bytes')::bigint, NULLIF(v_upload->>'video_duration_sec', '')::integer,
      COALESCE(p_marketing_consent, false), NULLIF(p_instagram, ''), NULLIF(p_tiktok, ''), NULLIF(p_testimonial, ''),
      NULLIF(v_upload->>'width', '')::int, NULLIF(v_upload->>'height', '')::int, NULLIF(v_upload->>'taken_at', '')::timestamptz)
    RETURNING id INTO v_upload_id;

    v_result := array_append(v_result, v_upload_id);

    IF p_visible_to_user_ids IS NOT NULL THEN
      FOREACH v_visible_uid IN ARRAY p_visible_to_user_ids LOOP
        IF v_visible_uid <> v_user_id THEN
          INSERT INTO album_visibility (upload_id, visible_to_user_id) VALUES (v_upload_id, v_visible_uid) ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;
