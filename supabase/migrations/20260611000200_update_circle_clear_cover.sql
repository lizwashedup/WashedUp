-- ===========================================================================
-- NOT YET APPLIED. Batch 3, file 3/8. Reviewed at the batch-3 checkpoint;
-- applied to prod only on explicit go-ahead, in the batch order.
--
-- Audit MEDIUM / circle-identity deferral — let update_circle CLEAR the cover.
--   The live body sets cover_upload_id = COALESCE(p_cover_upload_id,
--   cover_upload_id), so passing NULL preserves the old cover and there is no way
--   to remove one. Blocks the "Remove cover" affordance.
--
-- Fix: add a trailing p_clear_cover boolean DEFAULT false. When true, the cover
-- is set NULL; otherwise the COALESCE-preserve behavior is unchanged. Everything
-- else in the body is reproduced verbatim from live prod.
--
-- Why DROP + CREATE (not a second overload): update_circle has exactly one
-- overload today. CREATE OR REPLACE cannot add an input parameter (it would make
-- a new signature and leave both), and two overloads would make PostgREST RPC
-- resolution ambiguous for callers that omit the new arg. Dropping the old 8-arg
-- signature first leaves one clean 9-arg function; gated callers that omit
-- p_clear_cover still resolve via its default.
--
-- Flag-off safety: gated (GROUPS_ENABLED off). Pure additive parameter; existing
-- gated callers behave identically.
-- ===========================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.update_circle(uuid, text, text, uuid, boolean, uuid[], uuid[], boolean);

CREATE OR REPLACE FUNCTION public.update_circle(
  p_circle_id        uuid,
  p_name             text    DEFAULT NULL::text,
  p_description      text    DEFAULT NULL::text,
  p_cover_upload_id  uuid    DEFAULT NULL::uuid,
  p_room_enabled     boolean DEFAULT NULL::boolean,
  p_promote_user_ids uuid[]  DEFAULT NULL::uuid[],
  p_demote_user_ids  uuid[]  DEFAULT NULL::uuid[],
  p_set_all_admins   boolean DEFAULT NULL::boolean,
  p_clear_cover      boolean DEFAULT false
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_creator uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_circle_admin(p_circle_id, v_uid) THEN
    RAISE EXCEPTION 'only an admin can update this circle';
  END IF;

  SELECT creator_user_id INTO v_creator FROM public.circles WHERE id = p_circle_id;

  UPDATE public.circles
  SET name         = COALESCE(NULLIF(btrim(p_name), ''), name),
      description   = COALESCE(p_description, description),
      cover_upload_id = CASE
                          WHEN p_clear_cover THEN NULL
                          ELSE COALESCE(p_cover_upload_id, cover_upload_id)
                        END,
      room_enabled  = COALESCE(p_room_enabled, room_enabled),
      updated_at    = now()
  WHERE id = p_circle_id;

  IF p_set_all_admins IS TRUE THEN
    UPDATE public.circle_members
    SET role = 'admin'
    WHERE circle_id = p_circle_id AND status = 'joined';
  END IF;

  IF p_promote_user_ids IS NOT NULL THEN
    UPDATE public.circle_members
    SET role = 'admin'
    WHERE circle_id = p_circle_id
      AND status = 'joined'
      AND user_id = ANY(p_promote_user_ids);
  END IF;

  IF p_demote_user_ids IS NOT NULL THEN
    UPDATE public.circle_members
    SET role = 'member'
    WHERE circle_id = p_circle_id
      AND status = 'joined'
      AND user_id = ANY(p_demote_user_ids)
      AND (v_creator IS NULL OR user_id <> v_creator);
  END IF;
END;
$function$;

REVOKE ALL    ON FUNCTION public.update_circle(uuid, text, text, uuid, boolean, uuid[], uuid[], boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_circle(uuid, text, text, uuid, boolean, uuid[], uuid[], boolean, boolean) TO authenticated;

-- --- in-transaction self-test (rolls back; leaves no trace) ------------------
DO $$
DECLARE
  v_admin uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';   -- Liz
  v_circle uuid;
  v_cover1 uuid := gen_random_uuid();
  v_cover2 uuid := gen_random_uuid();
  v_after  uuid;
BEGIN
  BEGIN
    -- Seed an admin-owned circle that already has a cover.
    INSERT INTO public.circles (name, creator_user_id, cover_upload_id, status)
    VALUES ('clear-cover-selftest', v_admin, v_cover1, 'active')
    RETURNING id INTO v_circle;
    INSERT INTO public.circle_members (circle_id, user_id, role, status)
    VALUES (v_circle, v_admin, 'admin', 'joined');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

    -- Clear it.
    PERFORM public.update_circle(p_circle_id => v_circle, p_clear_cover => true);
    SELECT cover_upload_id INTO v_after FROM public.circles WHERE id = v_circle;
    IF v_after IS NOT NULL THEN
      RAISE EXCEPTION 'self-test: clear should null the cover, got %', v_after;
    END IF;

    -- Set a new cover with clear=false -> COALESCE-preserve path still works.
    PERFORM public.update_circle(p_circle_id => v_circle, p_cover_upload_id => v_cover2);
    SELECT cover_upload_id INTO v_after FROM public.circles WHERE id = v_circle;
    IF v_after IS DISTINCT FROM v_cover2 THEN
      RAISE EXCEPTION 'self-test: set-cover path broke, got %', v_after;
    END IF;

    -- A no-arg update must NOT wipe the cover (regression guard on the default).
    PERFORM public.update_circle(p_circle_id => v_circle, p_name => 'renamed');
    SELECT cover_upload_id INTO v_after FROM public.circles WHERE id = v_circle;
    IF v_after IS DISTINCT FROM v_cover2 THEN
      RAISE EXCEPTION 'self-test: default clear_cover=false must preserve cover, got %', v_after;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'update_circle clear-cover self-test passed';
END $$;

COMMIT;
