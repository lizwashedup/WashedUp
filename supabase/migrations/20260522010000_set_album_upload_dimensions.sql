-- Album upgrade Phase 3: client-driven backfill of album_uploads dimensions.
--
-- Why: the justified mosaic needs each photo's aspect ratio, but all 31 existing
-- album_uploads rows predate the width/height columns (added 20260522000000) and
-- are NULL. storage.objects.metadata holds no image dimensions, so dims can only
-- come from a client that has decoded the image. This RPC lets any joined member
-- who has rendered a thumbnail persist the measured dims, so each album backfills
-- itself the first time someone opens it.
--
-- Scope of this migration (the ENTIRE file):
--   1. CREATE OR REPLACE FUNCTION set_album_upload_dimensions(uuid, int, int).
--   2. GRANT EXECUTE to authenticated.
-- No table/column changes, no RLS changes, no other functions, no data writes
-- by the migration itself.
--
-- Safety properties:
--   * SECURITY DEFINER but authorization is enforced in-body: the caller must be
--     a 'joined' member of the upload's event (album_uploads -> plan_albums ->
--     event_members), mirroring start_album_upload_batch's membership gate.
--   * Fills dims ONLY when BOTH width and height are currently NULL, so it can
--     never overwrite real EXIF dims written by the upload path.
--   * Rejects non-positive dims (the client's onLoad can report 0 on decode race).
--   * Idempotent: a second call on an already-filled row updates nothing.

CREATE OR REPLACE FUNCTION public.set_album_upload_dimensions(
  p_upload_id uuid,
  p_width integer,
  p_height integer
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  -- Ignore garbage dims rather than erroring: the client fires this opportunistically
  -- from onLoad and a decode race can yield 0. Nothing to persist, report false.
  IF p_width IS NULL OR p_height IS NULL OR p_width <= 0 OR p_height <= 0 THEN
    RETURN false;
  END IF;

  UPDATE public.album_uploads au
     SET width = p_width, height = p_height
   WHERE au.id = p_upload_id
     AND au.width IS NULL          -- backfill only; never overwrite real EXIF dims
     AND au.height IS NULL
     AND au.deleted_at IS NULL
     AND EXISTS (
       SELECT 1
       FROM public.plan_albums pa
       JOIN public.event_members em ON em.event_id = pa.event_id
       WHERE pa.id = au.plan_album_id
         AND em.user_id = v_user_id
         AND em.status = 'joined'
     );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_album_upload_dimensions(uuid, integer, integer) TO authenticated;
