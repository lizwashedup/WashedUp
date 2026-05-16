-- Albums: personal custom cover + archive empty albums.
--
-- Applied directly to production Supabase (preview branches are broken for
-- this repo; this script is transactional with embedded DO-block self-tests
-- that RAISE EXCEPTION to force rollback on any failure).
--
-- Changes:
--  1. album_user_metadata.cover_upload_id  — per-user chosen cover photo.
--  2. plan_albums.archived_at              — empty-album archival marker.
--  3. set_album_user_metadata(...)         — rebuilt FROM THE PROD DEFINITION
--     (local migrations drift from prod) with a trailing p_cover_upload_id
--     param defaulted to NULL. The old 4-arg overload is dropped so the
--     existing 4 named-arg client call resolves unambiguously.
--  4. archive_empty_albums()               — cron: archive albums with zero
--     uploads 48h after the upload prompt.
--  5. archive_empty_album(p_event_id)      — manual archive RPC (joined
--     member, only while the album still has no uploads).

BEGIN;

-- ─── 1. New columns ──────────────────────────────────────────────────────────

ALTER TABLE album_user_metadata
  ADD COLUMN IF NOT EXISTS cover_upload_id uuid
  REFERENCES album_uploads(id) ON DELETE SET NULL;

ALTER TABLE plan_albums
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ─── 2. set_album_user_metadata: add p_cover_upload_id ───────────────────────
-- Drop the old 4-arg overload first so PostgREST does not see two candidates
-- for the existing 4 named-arg client call.

DROP FUNCTION IF EXISTS public.set_album_user_metadata(uuid, text, text, boolean);

CREATE OR REPLACE FUNCTION public.set_album_user_metadata(
  p_plan_album_id uuid,
  p_custom_name text,
  p_memory_note text,
  p_notifications_muted boolean,
  p_cover_upload_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plan_albums pa
    JOIN event_members em ON em.event_id = pa.event_id
    WHERE pa.id = p_plan_album_id AND em.user_id = v_user_id AND em.status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member of this album' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Cover, if given, must be a live upload belonging to this album.
  IF p_cover_upload_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM album_uploads au
    WHERE au.id = p_cover_upload_id
      AND au.plan_album_id = p_plan_album_id
      AND au.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'cover photo is not part of this album' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO album_user_metadata
    (plan_album_id, user_id, custom_name, memory_note, notifications_muted, cover_upload_id)
  VALUES
    (p_plan_album_id, v_user_id, NULLIF(p_custom_name, ''), NULLIF(p_memory_note, ''),
     COALESCE(p_notifications_muted, false), p_cover_upload_id)
  ON CONFLICT (plan_album_id, user_id) DO UPDATE
    SET custom_name = EXCLUDED.custom_name,
        memory_note = EXCLUDED.memory_note,
        notifications_muted = COALESCE(EXCLUDED.notifications_muted, album_user_metadata.notifications_muted),
        cover_upload_id = EXCLUDED.cover_upload_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_album_user_metadata(uuid, text, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_album_user_metadata(uuid, text, text, boolean, uuid) TO authenticated;

-- ─── 3. archive_empty_albums(): cron ─────────────────────────────────────────
-- Mirrors the 48h window already used by nudge_creators_no_uploads().

CREATE OR REPLACE FUNCTION public.archive_empty_albums()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE plan_albums pa
  SET archived_at = now()
  WHERE pa.prompt_sent_at IS NOT NULL
    AND pa.prompt_sent_at + interval '48 hours' <= now()
    AND pa.first_upload_at IS NULL
    AND pa.archived_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_empty_albums() FROM PUBLIC;

DO $$ BEGIN
  PERFORM cron.unschedule('albums-archive-empty');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('albums-archive-empty', '30 18 * * *',
  $cron$ SELECT public.archive_empty_albums(); $cron$);

-- ─── 4. archive_empty_album(): manual ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_empty_album(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM event_members em
    WHERE em.event_id = p_event_id AND em.user_id = v_user_id AND em.status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member of this event' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE plan_albums
  SET archived_at = now()
  WHERE event_id = p_event_id
    AND first_upload_at IS NULL
    AND archived_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_empty_album(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_empty_album(uuid) TO authenticated;

-- ─── 5. Self-tests (force rollback on any failure) ───────────────────────────

DO $$
DECLARE v_def text; v_sched text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='album_user_metadata' AND column_name='cover_upload_id') THEN
    RAISE EXCEPTION 'self-test: album_user_metadata.cover_upload_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='plan_albums' AND column_name='archived_at') THEN
    RAISE EXCEPTION 'self-test: plan_albums.archived_at missing';
  END IF;

  -- exactly one set_album_user_metadata, the 5-arg one
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='set_album_user_metadata') <> 1 THEN
    RAISE EXCEPTION 'self-test: set_album_user_metadata overload count != 1';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='set_album_user_metadata';
  IF v_def NOT LIKE '%p_cover_upload_id%' THEN
    RAISE EXCEPTION 'self-test: set_album_user_metadata missing p_cover_upload_id';
  END IF;
  IF v_def NOT LIKE '%not a joined member of this album%' THEN
    RAISE EXCEPTION 'self-test: set_album_user_metadata lost joined-member guard';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='archive_empty_albums';
  IF v_def IS NULL OR v_def NOT LIKE '%interval ''48 hours''%' THEN
    RAISE EXCEPTION 'self-test: archive_empty_albums missing or wrong window';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='archive_empty_album';
  IF v_def IS NULL OR v_def NOT LIKE '%not a joined member of this event%' THEN
    RAISE EXCEPTION 'self-test: archive_empty_album missing or missing guard';
  END IF;

  SELECT schedule INTO v_sched FROM cron.job WHERE jobname='albums-archive-empty';
  IF v_sched IS DISTINCT FROM '30 18 * * *' THEN
    RAISE EXCEPTION 'self-test: albums-archive-empty cron not scheduled (got %)', v_sched;
  END IF;
END
$$ LANGUAGE plpgsql;

COMMIT;
