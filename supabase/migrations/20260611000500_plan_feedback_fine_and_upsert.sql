-- ===========================================================================
-- NOT YET APPLIED. Batch 3, file 6/8. Reviewed at the batch-3 checkpoint;
-- applied to prod only on explicit go-ahead, in the batch order.
--
-- Post-plan survey v3 backend (post-plan-survey-spec.md): "It was fine" becomes a
-- REAL stored rating, and the survey writes through an UPSERT so a retry can never
-- silently fail (spec safety rail #3).
--
-- Live state: plan_feedback.rating CHECK allows only thumbs_up/thumbs_down (rating
-- is nullable, so NULL still passes). UNIQUE(event_id,user_id) exists. attended is
-- NOT NULL. The legacy + v2 surveys INSERT directly today.
--
--   * Widen the CHECK to include 'fine'.
--   * Add upsert_plan_feedback: INSERT ... ON CONFLICT (event_id,user_id) DO
--     UPDATE, user_id forced to auth.uid(). attended DEFAULTs true -- v3 never
--     asks the taker whether THEY attended (who-made-it writes no_show_reports
--     for OTHERS), so a rating-only step-1 write succeeds and a later comment
--     write upserts the same row. Guarded to joined members (the only people the
--     survey ever surfaces a plan to).
--
-- Flag-off safety: widening a CHECK only admits a new value (no existing row
-- violated). The RPC is new/dormant until the v3 client calls it; the legacy
-- direct-insert path keeps working unchanged.
-- ===========================================================================
BEGIN;

ALTER TABLE public.plan_feedback DROP CONSTRAINT plan_feedback_rating_check;
ALTER TABLE public.plan_feedback ADD CONSTRAINT plan_feedback_rating_check
  CHECK (rating = ANY (ARRAY['thumbs_up'::text, 'thumbs_down'::text, 'fine'::text]));

CREATE OR REPLACE FUNCTION public.upsert_plan_feedback(
  p_event_id uuid,
  p_rating   text,
  p_comment  text    DEFAULT NULL,
  p_attended boolean DEFAULT true
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_rating IS NOT NULL AND p_rating NOT IN ('thumbs_up','thumbs_down','fine') THEN
    RAISE EXCEPTION 'invalid_rating';
  END IF;
  -- Only joined members of the plan can leave feedback (the survey only ever
  -- surfaces plans the user joined).
  IF NOT EXISTS (
    SELECT 1 FROM public.event_members em
    WHERE em.event_id = p_event_id AND em.user_id = v_uid AND em.status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  INSERT INTO public.plan_feedback (event_id, user_id, attended, rating, comment)
  VALUES (p_event_id, v_uid, p_attended, p_rating, p_comment)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET attended = EXCLUDED.attended,
        rating   = EXCLUDED.rating,
        comment  = EXCLUDED.comment;
END;
$function$;

REVOKE ALL    ON FUNCTION public.upsert_plan_feedback(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_plan_feedback(uuid, text, text, boolean) TO authenticated;

-- --- in-transaction self-test (rolls back; leaves no trace) ------------------
DO $$
DECLARE
  v_uid   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';   -- Liz
  v_event uuid;
  v_cnt   int;
  v_row   public.plan_feedback%ROWTYPE;
BEGIN
  BEGIN
    INSERT INTO public.events (title, creator_user_id, start_time, end_time, status, gender_rule, min_invites, max_invites, member_count, city)
    VALUES ('feedback-selftest', v_uid, now() - interval '1 day', now() - interval '21 hours',
            'completed', 'mixed', 1, 8, 1, 'Los Angeles')
    RETURNING id INTO v_event;
    INSERT INTO public.event_members (event_id, user_id, role, status)
    VALUES (v_event, v_uid, 'host', 'joined');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

    -- Step 1: 'fine' stores as a real value, one row.
    PERFORM public.upsert_plan_feedback(v_event, 'fine');
    SELECT * INTO v_row FROM public.plan_feedback WHERE event_id = v_event AND user_id = v_uid;
    IF v_row.rating IS DISTINCT FROM 'fine' THEN
      RAISE EXCEPTION 'self-test: expected fine, got %', v_row.rating;
    END IF;

    -- Re-submit with a comment: still exactly one row, updated (upsert).
    PERFORM public.upsert_plan_feedback(v_event, 'thumbs_down', 'ran late');
    SELECT count(*) INTO v_cnt FROM public.plan_feedback WHERE event_id = v_event AND user_id = v_uid;
    SELECT * INTO v_row FROM public.plan_feedback WHERE event_id = v_event AND user_id = v_uid;
    IF v_cnt <> 1 OR v_row.rating <> 'thumbs_down' OR v_row.comment IS DISTINCT FROM 'ran late' THEN
      RAISE EXCEPTION 'self-test: upsert did not update in place (cnt %, rating %, comment %)',
        v_cnt, v_row.rating, v_row.comment;
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'plan_feedback fine+upsert self-test passed';
END $$;

COMMIT;
