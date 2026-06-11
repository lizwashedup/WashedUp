-- ===========================================================================
-- NOT YET APPLIED. Batch 3, file 8/8. Reviewed at the batch-3 checkpoint;
-- applied to prod only on explicit go-ahead, in the batch order.
--
-- Audit LOW — the review-ask must skip sentinel rows.
--   The app-store review prompt is decided client-side in app/_layout.tsx:
--     .from('plan_feedback').select('rating').eq('user_id', uid).limit(10)
--     -> show if any rating='thumbs_up' OR zero rows.
--   It reads only `rating`, so the 62 synthetic sentinel rows (comment='sentinel',
--   backfilled 2026-05-18) can register as real feedback and are never excluded.
--   `comment IS DISTINCT FROM 'sentinel'` has no clean PostgREST spelling (a plain
--   .neq drops NULL-comment rows too), so the guard belongs server-side.
--
-- New get_review_ask_eligibility() -> boolean replicates the live rule over
-- NON-sentinel rows: eligible when a real thumbs_up exists OR there is no real
-- feedback at all. The 2+-completed-plans precondition stays client-side; the
-- front-end swaps its inline plan_feedback query for this RPC (paired front-end
-- change, tracked in the checkpoint).
--
-- Flag-off safety: a new, dormant read-only function; nothing calls it until the
-- front-end is updated. Zero change to existing behavior.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_review_ask_eligibility()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_has_thumbs_up boolean;
  v_has_real_feedback boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.plan_feedback pf
      WHERE pf.user_id = v_uid
        AND pf.rating = 'thumbs_up'
        AND pf.comment IS DISTINCT FROM 'sentinel'
    ),
    EXISTS (
      SELECT 1 FROM public.plan_feedback pf
      WHERE pf.user_id = v_uid
        AND pf.comment IS DISTINCT FROM 'sentinel'
    )
  INTO v_has_thumbs_up, v_has_real_feedback;

  -- eligible: a real thumbs_up, OR no real feedback yet.
  RETURN v_has_thumbs_up OR NOT v_has_real_feedback;
END;
$function$;

REVOKE ALL    ON FUNCTION public.get_review_ask_eligibility() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_review_ask_eligibility() TO authenticated;

-- --- in-transaction self-test (rolls back; leaves no trace) ------------------
DO $$
DECLARE
  v_uid uuid := 'cafe0001-0000-0000-0000-000000000001';   -- Sage (test user)
  v_e1 uuid; v_e2 uuid; v_e3 uuid;
  v_elig boolean;
BEGIN
  BEGIN
    -- Isolate this user's feedback (rolled back).
    DELETE FROM public.plan_feedback WHERE user_id = v_uid;

    INSERT INTO public.events (title, creator_user_id, start_time, status, gender_rule, min_invites, max_invites, member_count, city)
      VALUES ('rev1', v_uid, now() - interval '2 days', 'completed', 'mixed', 1, 8, 1, 'Los Angeles') RETURNING id INTO v_e1;
    INSERT INTO public.events (title, creator_user_id, start_time, status, gender_rule, min_invites, max_invites, member_count, city)
      VALUES ('rev2', v_uid, now() - interval '2 days', 'completed', 'mixed', 1, 8, 1, 'Los Angeles') RETURNING id INTO v_e2;
    INSERT INTO public.events (title, creator_user_id, start_time, status, gender_rule, min_invites, max_invites, member_count, city)
      VALUES ('rev3', v_uid, now() - interval '2 days', 'completed', 'mixed', 1, 8, 1, 'Los Angeles') RETURNING id INTO v_e3;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

    -- State A: ONLY a sentinel thumbs_down. Without the guard this returns FALSE
    -- (a row exists, no thumbs_up); with the guard the sentinel is invisible ->
    -- "no real feedback" -> TRUE. Asserting TRUE proves the guard.
    INSERT INTO public.plan_feedback (event_id, user_id, attended, rating, comment)
      VALUES (v_e1, v_uid, true, 'thumbs_down', 'sentinel');
    v_elig := public.get_review_ask_eligibility();
    IF v_elig IS NOT TRUE THEN
      RAISE EXCEPTION 'self-test A: sentinel-only must read as no-feedback -> eligible';
    END IF;

    -- State B: a REAL thumbs_down -> has real feedback, no thumbs_up -> FALSE.
    INSERT INTO public.plan_feedback (event_id, user_id, attended, rating, comment)
      VALUES (v_e2, v_uid, true, 'thumbs_down', 'meh');
    v_elig := public.get_review_ask_eligibility();
    IF v_elig IS NOT FALSE THEN
      RAISE EXCEPTION 'self-test B: real non-thumbs_up feedback -> not eligible';
    END IF;

    -- State C: a REAL thumbs_up -> eligible again.
    INSERT INTO public.plan_feedback (event_id, user_id, attended, rating, comment)
      VALUES (v_e3, v_uid, true, 'thumbs_up', NULL);
    v_elig := public.get_review_ask_eligibility();
    IF v_elig IS NOT TRUE THEN
      RAISE EXCEPTION 'self-test C: a real thumbs_up -> eligible';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'review-ask eligibility self-test passed';
END $$;

COMMIT;
