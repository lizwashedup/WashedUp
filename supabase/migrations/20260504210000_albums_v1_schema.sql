-- Albums v1: 5 tables, RLS, RPCs, trigger, album-media private bucket.
-- Documentation-only. Applied directly in production Supabase on 2026-05-05.
-- Depends on: 20260504200000_drop_album_v0.sql.
--
-- Order: type CHECK extension → ALL tables (no policies yet so cross-table
-- forward refs in policies resolve) → ENABLE RLS + policies → bucket +
-- bucket policies → SECURITY DEFINER RPCs → after-insert trigger → self-test.
--
-- Spec: WashedUp_Albums_Feature_Spec.docx v2.1. Comments (v1.1) deferred.

-- 1. Notification type CHECK extension
ALTER TABLE app_notifications DROP CONSTRAINT IF EXISTS app_notifications_type_check;
ALTER TABLE app_notifications ADD CONSTRAINT app_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'waitlist_spot','broadcast','event_reminder','member_joined','plan_invite','invite_accepted','new_message',
    'album_ready','plan_cancelled','duplicate_plan','interest_signal','interest_invite',
    'album_upload_prompt','album_upload_reminder','album_someone_uploaded',
    'album_more_photos_added','album_creator_no_uploads_nudge','album_hearts_batched'
  ]::text[]));

-- 2. Tables (no policies yet)

-- album_ready_at is NOT a stored column: timestamptz + interval is treated
-- as STABLE by PostgreSQL so it cannot back a GENERATED column. The cron
-- query computes (first_upload_at + interval '24 hours') <= now() inline.
CREATE TABLE plan_albums (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting','developing','ready')),
  first_upload_at timestamptz,
  prompt_sent_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_plan_albums_event ON plan_albums (event_id);
CREATE INDEX idx_plan_albums_developing_first_upload ON plan_albums (first_upload_at)
  WHERE status = 'developing' AND first_upload_at IS NOT NULL;

CREATE TABLE album_uploads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_album_id      uuid NOT NULL REFERENCES plan_albums(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_url          text NOT NULL,         -- storage path to original
  thumbnail_url      text,                  -- set by image processor
  display_url        text,                  -- set by image processor
  content_type       text NOT NULL CHECK (content_type IN ('photo','video')),
  media_format       text NOT NULL,
  file_size_bytes    bigint NOT NULL CHECK (file_size_bytes > 0),
  video_duration_sec integer CHECK (video_duration_sec IS NULL OR video_duration_sec <= 60),
  marketing_consent  boolean NOT NULL DEFAULT false,
  instagram_handle   text,
  tiktok_handle      text,
  testimonial_text   text,
  heart_count        integer NOT NULL DEFAULT 0 CHECK (heart_count >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX idx_album_uploads_album ON album_uploads (plan_album_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_album_uploads_user ON album_uploads (user_id);
CREATE INDEX idx_album_uploads_marketing ON album_uploads (marketing_consent) WHERE marketing_consent = true AND deleted_at IS NULL;
CREATE INDEX idx_album_uploads_created ON album_uploads (created_at);

CREATE TABLE album_visibility (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id           uuid NOT NULL REFERENCES album_uploads(id) ON DELETE CASCADE,
  visible_to_user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  hidden_by_viewer    boolean NOT NULL DEFAULT false,
  UNIQUE (upload_id, visible_to_user_id)
);
CREATE INDEX idx_album_visibility_viewer ON album_visibility (visible_to_user_id);
CREATE INDEX idx_album_visibility_upload ON album_visibility (upload_id);

CREATE TABLE album_user_metadata (
  plan_album_id              uuid NOT NULL REFERENCES plan_albums(id) ON DELETE CASCADE,
  user_id                    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  custom_name                text,
  memory_note                text,
  notifications_muted        boolean NOT NULL DEFAULT false,
  last_viewed_at             timestamptz,
  last_heart_notification_at timestamptz,  -- used by heart-batching cron
  PRIMARY KEY (plan_album_id, user_id)
);
CREATE INDEX idx_album_user_metadata_user ON album_user_metadata (user_id);

CREATE TABLE album_hearts (
  upload_id  uuid NOT NULL REFERENCES album_uploads(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (upload_id, user_id)
);
CREATE INDEX idx_album_hearts_user ON album_hearts (user_id);
CREATE INDEX idx_album_hearts_created ON album_hearts (created_at);

-- 3. Enable RLS
ALTER TABLE plan_albums         ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_uploads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_visibility    ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_user_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE album_hearts        ENABLE ROW LEVEL SECURITY;

-- 4. Policies (tables now exist so any cross-table USING clause resolves)

CREATE POLICY "joined members can read plan_albums"
  ON plan_albums FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = plan_albums.event_id AND em.user_id = auth.uid() AND em.status = 'joined'));

CREATE POLICY "viewers can read visible album_uploads"
  ON album_uploads FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL AND (
      user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM album_visibility av WHERE av.upload_id = album_uploads.id AND av.visible_to_user_id = auth.uid() AND av.hidden_by_viewer = false)
    )
  );

CREATE POLICY "users can read own album_visibility"
  ON album_visibility FOR SELECT TO authenticated USING (visible_to_user_id = auth.uid());
CREATE POLICY "users can hide own album_visibility row"
  ON album_visibility FOR UPDATE TO authenticated
  USING (visible_to_user_id = auth.uid()) WITH CHECK (visible_to_user_id = auth.uid());

CREATE POLICY "users read own album_user_metadata"
  ON album_user_metadata FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "members read album_hearts"
  ON album_hearts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM album_uploads au
    JOIN plan_albums pa ON pa.id = au.plan_album_id
    JOIN event_members em ON em.event_id = pa.event_id
    WHERE au.id = album_hearts.upload_id AND em.user_id = auth.uid() AND em.status = 'joined'
  ));

-- 5. Storage bucket album-media (private) + bucket policies.
-- Path layout: {event_id}/{user_id}/{upload_id}/{filename} — the visibility
-- SELECT policy reads upload_id from path[3] to gate signed-URL generation.

INSERT INTO storage.buckets (id, name, public) VALUES ('album-media','album-media',false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "users can upload to album-media for joined events"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'album-media'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND EXISTS (SELECT 1 FROM event_members em WHERE em.event_id::text = (storage.foldername(name))[1] AND em.user_id = auth.uid() AND em.status = 'joined')
  );

-- Visibility-aware SELECT lets the JS SDK's createSignedUrl succeed only for
-- viewers album_visibility allows. Soft-deleted uploads become unreadable.
CREATE POLICY "users read album-media if visible"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'album-media'
    AND EXISTS (
      SELECT 1 FROM album_uploads au
      WHERE au.id::text = (storage.foldername(name))[3] AND au.deleted_at IS NULL
        AND (au.user_id = auth.uid() OR EXISTS (SELECT 1 FROM album_visibility av WHERE av.upload_id = au.id AND av.visible_to_user_id = auth.uid() AND av.hidden_by_viewer = false))
    )
  );

CREATE POLICY "users delete own album-media objects"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'album-media' AND (storage.foldername(name))[2] = auth.uid()::text);

-- 6. SECURITY DEFINER RPCs (user-facing writes).
-- All writes flow through these. Direct INSERT/UPDATE/DELETE on the new
-- tables is denied by RLS (no policies for those verbs except hide-own).

-- start_album_upload_batch:
-- p_uploads is JSONB array of { id, media_url, content_type, media_format,
-- file_size_bytes, video_duration_sec? }. The id field MUST match
-- path[3] in media_url so the storage SELECT policy resolves it back to
-- album_uploads. The function validates path[1]=event_id and path[2]=user_id
-- to prevent crafted paths.
CREATE OR REPLACE FUNCTION start_album_upload_batch(
  p_event_id uuid, p_uploads jsonb, p_visible_to_user_ids uuid[],
  p_marketing_consent boolean, p_instagram text, p_tiktok text, p_testimonial text)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $func$
DECLARE
  v_user_id uuid := auth.uid();
  v_album_id uuid;
  v_existing_photo_count int; v_existing_video_count int;
  v_new_photo_count int; v_new_video_count int;
  v_upload jsonb; v_upload_id uuid;
  v_result uuid[] := ARRAY[]::uuid[];
  v_visible_uid uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_uploads IS NULL OR jsonb_typeof(p_uploads) <> 'array' OR jsonb_array_length(p_uploads) = 0 THEN
    RAISE EXCEPTION 'p_uploads must be a non-empty JSON array';
  END IF;
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

  SELECT COUNT(*) FILTER (WHERE content_type = 'photo'), COUNT(*) FILTER (WHERE content_type = 'video')
  INTO v_existing_photo_count, v_existing_video_count
  FROM album_uploads WHERE plan_album_id = v_album_id AND user_id = v_user_id AND deleted_at IS NULL;

  SELECT COUNT(*) FILTER (WHERE u->>'content_type' = 'photo'), COUNT(*) FILTER (WHERE u->>'content_type' = 'video')
  INTO v_new_photo_count, v_new_video_count
  FROM jsonb_array_elements(p_uploads) AS u;

  IF (v_existing_photo_count + v_new_photo_count) > 20 THEN RAISE EXCEPTION 'photo cap exceeded (20 max per album per person)' USING ERRCODE = 'check_violation'; END IF;
  IF (v_existing_video_count + v_new_video_count) > 6  THEN RAISE EXCEPTION 'video cap exceeded (6 max per album per person)' USING ERRCODE = 'check_violation'; END IF;

  FOR v_upload IN SELECT * FROM jsonb_array_elements(p_uploads) LOOP
    IF (v_upload->>'id') IS NULL THEN RAISE EXCEPTION 'each upload must include an id (uuid)'; END IF;
    IF (string_to_array(v_upload->>'media_url', '/'))[3] <> (v_upload->>'id') THEN RAISE EXCEPTION 'media_url path[3] must equal the upload id'; END IF;
    IF (string_to_array(v_upload->>'media_url', '/'))[1] <> p_event_id::text THEN RAISE EXCEPTION 'media_url path[1] must equal the event id'; END IF;
    IF (string_to_array(v_upload->>'media_url', '/'))[2] <> v_user_id::text THEN RAISE EXCEPTION 'media_url path[2] must equal the caller user id'; END IF;

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

CREATE OR REPLACE FUNCTION record_album_heart(p_upload_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE v_user_id uuid := auth.uid(); v_uploader uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id INTO v_uploader FROM album_uploads WHERE id = p_upload_id AND deleted_at IS NULL;
  IF v_uploader IS NULL THEN RAISE EXCEPTION 'upload not found'; END IF;
  IF v_uploader = v_user_id THEN RAISE EXCEPTION 'cannot heart your own upload' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO album_hearts (upload_id, user_id) VALUES (p_upload_id, v_user_id) ON CONFLICT DO NOTHING;
  UPDATE album_uploads SET heart_count = (SELECT COUNT(*) FROM album_hearts WHERE upload_id = p_upload_id) WHERE id = p_upload_id;
END; $func$;
REVOKE ALL ON FUNCTION record_album_heart(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_album_heart(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION remove_album_heart(p_upload_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  DELETE FROM album_hearts WHERE upload_id = p_upload_id AND user_id = v_user_id;
  UPDATE album_uploads SET heart_count = (SELECT COUNT(*) FROM album_hearts WHERE upload_id = p_upload_id) WHERE id = p_upload_id;
END; $func$;
REVOKE ALL ON FUNCTION remove_album_heart(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_album_heart(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION soft_delete_album_upload(p_upload_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE album_uploads SET deleted_at = now() WHERE id = p_upload_id AND user_id = v_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'upload not found or not yours'; END IF;
END; $func$;
REVOKE ALL ON FUNCTION soft_delete_album_upload(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION soft_delete_album_upload(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION update_album_marketing_consent(p_upload_id uuid, p_consent boolean, p_instagram text, p_tiktok text, p_testimonial text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  UPDATE album_uploads
    SET marketing_consent = COALESCE(p_consent, marketing_consent),
        instagram_handle  = NULLIF(p_instagram, ''),
        tiktok_handle     = NULLIF(p_tiktok, ''),
        testimonial_text  = NULLIF(p_testimonial, '')
    WHERE id = p_upload_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'upload not found or not yours'; END IF;
END; $func$;
REVOKE ALL ON FUNCTION update_album_marketing_consent(uuid, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_album_marketing_consent(uuid, boolean, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION set_album_user_metadata(p_plan_album_id uuid, p_custom_name text, p_memory_note text, p_notifications_muted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plan_albums pa JOIN event_members em ON em.event_id = pa.event_id WHERE pa.id = p_plan_album_id AND em.user_id = v_user_id AND em.status = 'joined') THEN
    RAISE EXCEPTION 'not a joined member of this album' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO album_user_metadata (plan_album_id, user_id, custom_name, memory_note, notifications_muted)
  VALUES (p_plan_album_id, v_user_id, NULLIF(p_custom_name, ''), NULLIF(p_memory_note, ''), COALESCE(p_notifications_muted, false))
  ON CONFLICT (plan_album_id, user_id) DO UPDATE
    SET custom_name = EXCLUDED.custom_name,
        memory_note = EXCLUDED.memory_note,
        notifications_muted = COALESCE(EXCLUDED.notifications_muted, album_user_metadata.notifications_muted);
END; $func$;
REVOKE ALL ON FUNCTION set_album_user_metadata(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_album_user_metadata(uuid, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION mark_album_viewed(p_plan_album_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  INSERT INTO album_user_metadata (plan_album_id, user_id, last_viewed_at)
  VALUES (p_plan_album_id, v_user_id, now())
  ON CONFLICT (plan_album_id, user_id) DO UPDATE SET last_viewed_at = now();
END; $func$;
REVOKE ALL ON FUNCTION mark_album_viewed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_album_viewed(uuid) TO authenticated;

-- Note: there is intentionally no get_album_signed_urls() RPC. The client
-- reads album_uploads directly (RLS filters by visibility) and calls
-- supabase.storage.from('album-media').createSignedUrl(path, ttl) per row.
-- The storage SELECT policy enforces the same visibility check at sign time.

-- 7. Trigger: fan out push notifications on upload insert.
CREATE OR REPLACE FUNCTION trg_album_upload_after_insert_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $func$
DECLARE
  v_event_id uuid; v_album_status text; v_event_title text; v_uploader_name text; v_notif_type text;
BEGIN
  SELECT pa.event_id, pa.status, e.title INTO v_event_id, v_album_status, v_event_title
  FROM plan_albums pa JOIN events e ON e.id = pa.event_id WHERE pa.id = NEW.plan_album_id;
  SELECT first_name_display INTO v_uploader_name FROM profiles WHERE id = NEW.user_id;
  v_notif_type := CASE WHEN v_album_status = 'ready' THEN 'album_more_photos_added' ELSE 'album_someone_uploaded' END;
  INSERT INTO app_notifications (user_id, type, title, body, event_id)
  SELECT em.user_id, v_notif_type,
         COALESCE(v_uploader_name, 'Someone') ||
           CASE WHEN v_notif_type = 'album_more_photos_added' THEN ' added more photos to ' || v_event_title
                ELSE ' uploaded photos to ' || v_event_title END,
         'Open the album to take a look', v_event_id
  FROM event_members em
  WHERE em.event_id = v_event_id AND em.status = 'joined' AND em.user_id <> NEW.user_id
    AND NOT EXISTS (SELECT 1 FROM plan_attendance pa WHERE pa.event_id = v_event_id AND pa.user_id = em.user_id AND pa.was_present = false)
    AND NOT EXISTS (SELECT 1 FROM album_user_metadata aum WHERE aum.plan_album_id = NEW.plan_album_id AND aum.user_id = em.user_id AND aum.notifications_muted = true);
  RETURN NEW;
END; $func$;

CREATE TRIGGER trg_album_upload_after_insert
AFTER INSERT ON album_uploads FOR EACH ROW EXECUTE FUNCTION trg_album_upload_after_insert_fn();

-- 8. Self-test
DO $$
DECLARE v_table_count int; v_rpc_count int;
BEGIN
  SELECT COUNT(*) INTO v_table_count FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('plan_albums','album_uploads','album_visibility','album_user_metadata','album_hearts');
  IF v_table_count <> 5 THEN RAISE EXCEPTION 'albums_v1: expected 5 tables, found %', v_table_count; END IF;
  SELECT COUNT(*) INTO v_rpc_count FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname IN (
    'start_album_upload_batch','record_album_heart','remove_album_heart',
    'soft_delete_album_upload','update_album_marketing_consent',
    'set_album_user_metadata','mark_album_viewed','trg_album_upload_after_insert_fn');
  IF v_rpc_count <> 8 THEN RAISE EXCEPTION 'albums_v1: expected 8 functions, found %', v_rpc_count; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%album_upload_prompt%') THEN
    RAISE EXCEPTION 'albums_v1: type check did not include album_upload_prompt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'album-media' AND public = false) THEN
    RAISE EXCEPTION 'albums_v1: album-media bucket missing or not private';
  END IF;
END
$$ LANGUAGE plpgsql;
