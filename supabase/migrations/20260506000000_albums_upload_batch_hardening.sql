-- Albums v1: harden start_album_upload_batch against three audit findings.
-- Documentation-only. Applied directly in production Supabase on 2026-05-06.
--
-- Depends on: 20260504210000_albums_v1_schema.sql (created the original RPC).
--
-- Three changes, all in the body of start_album_upload_batch:
--
-- 1. (audit #3) Per-(event, user) advisory transaction lock at the top of the
--    RPC so two concurrent batches from the same user can't both pass the
--    cap check independently and end up with > 20 photos / > 6 videos for
--    the same person. Lock auto-releases on COMMIT/ROLLBACK; no deadlock
--    risk because the key shape is always the same per call.
--
-- 2. (audit #5) Stricter path validation: explicit array_length check on the
--    media_url path so a malformed value can't slip through the
--    "[3] <> id" comparison (Postgres returns NULL for out-of-bounds array
--    indexes, and IF NULL is treated as FALSE — meaning a 2-segment path
--    would skip the validation and land in the DB unreadable via storage
--    RLS). Now we raise on segment count first.
--
-- 3. (audit #6) Reject NULL video_duration_sec for content_type='video'.
--    The column itself allows NULL (so photos can omit it) but a video
--    with no duration metadata could otherwise bypass the 60-second cap
--    silently. The client already rejects videos with no duration at the
--    picker (in app/album/upload/[eventId].tsx) but server-side defense
--    in depth covers malicious / non-standard clients.
--
-- Behavior change: for #2 and #3, malformed inputs that previously slipped
-- through into the DB now raise EXCEPTION and the entire batch fails (with
-- a clear error message). The orchestrator will mark the batch failed and
-- the user will see a single actionable error instead of a silently-broken
-- album row.

CREATE OR REPLACE FUNCTION start_album_upload_batch(
  p_event_id              uuid,
  p_uploads               jsonb,
  p_visible_to_user_ids   uuid[],
  p_marketing_consent     boolean,
  p_instagram             text,
  p_tiktok                text,
  p_testimonial           text
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_user_id        uuid := auth.uid();
  v_album_id       uuid;
  v_existing_photo_count int;
  v_existing_video_count int;
  v_new_photo_count int;
  v_new_video_count int;
  v_upload         jsonb;
  v_upload_id      uuid;
  v_result         uuid[] := ARRAY[]::uuid[];
  v_visible_uid    uuid;
  v_path_parts     text[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF p_uploads IS NULL OR jsonb_typeof(p_uploads) <> 'array' OR jsonb_array_length(p_uploads) = 0 THEN
    RAISE EXCEPTION 'p_uploads must be a non-empty JSON array';
  END IF;

  -- (#3) Advisory lock per (event, user). Serializes concurrent batches from
  -- the same user against the same plan so the cap check is honest. Auto
  -- releases on COMMIT.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_event_id::text || ':' || v_user_id::text)
  );

  IF NOT EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = p_event_id AND em.user_id = v_user_id AND em.status = 'joined') THEN
    RAISE EXCEPTION 'not a joined member of event %', p_event_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM plan_attendance pa WHERE pa.event_id = p_event_id AND pa.user_id = v_user_id AND pa.was_present = false) THEN
    RAISE EXCEPTION 'marked not-present, cannot upload to album' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO plan_albums (event_id, status, first_upload_at)
  VALUES (p_event_id, 'developing', now())
  ON CONFLICT (event_id) DO UPDATE
    SET status = CASE WHEN plan_albums.first_upload_at IS NULL THEN 'developing' ELSE plan_albums.status END,
        first_upload_at = COALESCE(plan_albums.first_upload_at, now())
  RETURNING id INTO v_album_id;

  SELECT
    COUNT(*) FILTER (WHERE content_type = 'photo'),
    COUNT(*) FILTER (WHERE content_type = 'video')
  INTO v_existing_photo_count, v_existing_video_count
  FROM album_uploads
  WHERE plan_album_id = v_album_id AND user_id = v_user_id AND deleted_at IS NULL;

  SELECT
    COUNT(*) FILTER (WHERE u->>'content_type' = 'photo'),
    COUNT(*) FILTER (WHERE u->>'content_type' = 'video')
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

    -- (#5) Validate path SHAPE before indexing into it. A malformed value
    -- with < 4 segments would let later index comparisons return NULL and
    -- silently skip checks (NULL <> 'x' is NULL, which IF treats as FALSE).
    v_path_parts := string_to_array(v_upload->>'media_url', '/');
    IF v_path_parts IS NULL OR array_length(v_path_parts, 1) < 4 THEN
      RAISE EXCEPTION 'media_url must have at least 4 segments: {event_id}/{user_id}/{upload_id}/{filename}';
    END IF;

    IF v_path_parts[3] <> (v_upload->>'id') THEN RAISE EXCEPTION 'media_url path[3] must equal the upload id'; END IF;
    IF v_path_parts[1] <> p_event_id::text THEN RAISE EXCEPTION 'media_url path[1] must equal the event id'; END IF;
    IF v_path_parts[2] <> v_user_id::text THEN RAISE EXCEPTION 'media_url path[2] must equal the caller user id'; END IF;

    -- (#6) Reject NULL duration for videos. Photos still allowed to omit it.
    IF (v_upload->>'content_type') = 'video'
       AND (NULLIF(v_upload->>'video_duration_sec', '') IS NULL) THEN
      RAISE EXCEPTION 'video_duration_sec is required for videos and must be 1..60 seconds'
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO album_uploads (
      id, plan_album_id, user_id, media_url, content_type, media_format,
      file_size_bytes, video_duration_sec, marketing_consent, instagram_handle, tiktok_handle, testimonial_text)
    VALUES (
      (v_upload->>'id')::uuid, v_album_id, v_user_id,
      v_upload->>'media_url', v_upload->>'content_type', v_upload->>'media_format',
      (v_upload->>'file_size_bytes')::bigint, NULLIF(v_upload->>'video_duration_sec', '')::integer,
      COALESCE(p_marketing_consent, false), NULLIF(p_instagram, ''), NULLIF(p_tiktok, ''), NULLIF(p_testimonial, ''))
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
$func$;

REVOKE ALL ON FUNCTION start_album_upload_batch(uuid, jsonb, uuid[], boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_album_upload_batch(uuid, jsonb, uuid[], boolean, text, text, text) TO authenticated;

-- Self-test: raises if any of the three guards is missing from the live body.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'start_album_upload_batch'
  LIMIT 1;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'hardening: start_album_upload_batch missing';
  END IF;
  IF v_def NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'hardening: advisory lock missing from RPC body';
  END IF;
  IF v_def NOT LIKE '%array_length(v_path_parts, 1) < 4%' THEN
    RAISE EXCEPTION 'hardening: array_length path guard missing';
  END IF;
  IF v_def NOT LIKE '%video_duration_sec is required for videos%' THEN
    RAISE EXCEPTION 'hardening: video_duration_sec NOT NULL guard missing';
  END IF;
END
$$ LANGUAGE plpgsql;
