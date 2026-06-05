-- Circles: co-attendance suggestions (Step 10). Read + status + detection.
--
-- REVIEW ONLY. NOT applied by the agent. Sits on top of the circles schema
-- (20260530220*) and the circle_suggestions table from 220100 (read-own RLS).
--
-- *** ENG: VALIDATE THE DETECTION QUERY BEFORE APPLYING. ***
-- detect_circle_suggestions() is a co-attendance heuristic written against the
-- assumed event_members(user_id, event_id, status) shape with member_status
-- {joined,left,removed}. It groups a user's joined events by their EXACT joined
-- member-set and suggests any set of 3+ people that recurs across 3+ events.
-- Exact-set matching is the conservative v1 ("the same people, repeatedly");
-- fuzzy/overlapping-set clustering is a later refinement. Confirm event_members
-- column names + the joined-status value against prod before applying.
--
-- All RPCs SECURITY DEFINER with a pinned search_path; each authorizes on
-- auth.uid(). jsonb returns (not RETURNS TABLE) so there are no implicit
-- out-column vars to collide with. Idempotent; wrapped in a self-test.

BEGIN;

-- ---------------------------------------------------------------------------
-- get_circle_suggestions: the caller's pending co-attendance suggestions, with
-- the suggested people's display names + handles resolved and the shared-plan
-- count. Newest first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_circle_suggestions()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      s.id,
      s.suggested_user_ids,
      s.shared_event_ids,
      -- array_length returns NULL (not 0) for an empty array; coalesce so the
      -- client always gets a number for "N plans together".
      COALESCE(array_length(s.shared_event_ids, 1), 0) AS shared_count,
      s.created_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', p.id,
          'first_name_display', p.first_name_display,
          'handle', p.handle,
          'profile_photo_url', p.profile_photo_url
        ) ORDER BY p.first_name_display)
        FROM public.profiles p
        WHERE p.id = ANY(s.suggested_user_ids)
      ), '[]'::jsonb) AS people
    FROM public.circle_suggestions s
    WHERE s.user_id = v_uid AND s.status = 'pending'
  ) d;

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- set_circle_suggestion_status: owner-only transition to 'dismissed' (the user
-- said not now) or 'converted' (they started a circle from it). 'pending' is
-- not a valid target. RLS has no UPDATE policy by design, so this DEFINER RPC
-- is the only mutation path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_circle_suggestion_status(
  p_id     uuid,
  p_status text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_status NOT IN ('dismissed', 'converted') THEN
    RAISE EXCEPTION 'invalid status %', p_status;
  END IF;

  UPDATE public.circle_suggestions
  SET status = p_status
  WHERE id = p_id AND user_id = v_uid AND status = 'pending';

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  RETURN p_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- detect_circle_suggestions: populate pending suggestions from co-attendance.
-- Runs for ALL users (intended for a periodic job). Returns the row count
-- inserted. Skips sets that already have a pending/converted suggestion for
-- that user so re-running is non-duplicating.
--
-- *** ENG: validate against the real event_members shape before applying. ***
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_circle_suggestions()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH event_sets AS (
    -- Each event's exact joined member-set (only events with 3+ joined).
    SELECT
      em.event_id,
      array_agg(em.user_id ORDER BY em.user_id) AS member_set
    FROM public.event_members em
    WHERE em.status = 'joined'
    GROUP BY em.event_id
    HAVING count(*) >= 3
  ),
  recurring AS (
    -- Member-sets that recur across 3+ events. event_ids ordered for a
    -- deterministic shared_event_ids array.
    SELECT
      member_set,
      array_agg(event_id ORDER BY event_id) AS event_ids,
      count(*) AS plan_count
    FROM event_sets
    GROUP BY member_set
    HAVING count(*) >= 3
  ),
  per_user AS (
    -- One candidate suggestion per member of each recurring set: the OTHER
    -- members become that user's suggested_user_ids.
    SELECT
      u.uid AS user_id,
      array(SELECT x FROM unnest(r.member_set) x WHERE x <> u.uid ORDER BY x) AS suggested_user_ids,
      r.event_ids,
      r.plan_count
    FROM recurring r
    CROSS JOIN LATERAL unnest(r.member_set) AS u(uid)
  ),
  fresh AS (
    SELECT pu.*
    FROM per_user pu
    WHERE NOT EXISTS (
      -- Skip if this user already has a pending/converted suggestion for the
      -- exact same set (dismissed ones may resurface). uuid[] equality is
      -- order-sensitive, but BOTH sides are sorted: per_user.suggested_user_ids
      -- is built with ORDER BY above, and every circle_suggestions row is
      -- written by THIS function (the only inserter), also sorted. Keep that
      -- invariant if another writer is ever added.
      SELECT 1 FROM public.circle_suggestions s
      WHERE s.user_id = pu.user_id
        AND s.status IN ('pending', 'converted')
        AND s.suggested_user_ids = pu.suggested_user_ids
    )
    -- KNOWN V1 GAP (eng): this does NOT skip a set the user already has a real
    -- circle for (no dedup against circle_members). A user who built a circle
    -- of exactly these people by another path can still be nudged. Acceptable
    -- for v1; add a circle-membership NOT EXISTS if it proves noisy.
  ),
  ins AS (
    INSERT INTO public.circle_suggestions
      (user_id, suggested_user_ids, shared_event_ids, basis, score, status)
    SELECT user_id, suggested_user_ids, event_ids, 'co_attendance', plan_count, 'pending'
    FROM fresh
    WHERE array_length(suggested_user_ids, 1) >= 2
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_circle_suggestions()                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_circle_suggestion_status(uuid, text) FROM PUBLIC, anon;
-- detection is a job, not a client call: service_role only.
REVOKE ALL ON FUNCTION public.detect_circle_suggestions()              FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_circle_suggestions()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_circle_suggestion_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_circle_suggestions()              TO service_role;

-- ---------------------------------------------------------------------------
-- Self-test: the RPCs exist and are SECURITY DEFINER.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'get_circle_suggestions', 'set_circle_suggestion_status', 'detect_circle_suggestions'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = v_fn AND prosecdef) THEN
      RAISE EXCEPTION 'RPC % missing or not SECURITY DEFINER', v_fn;
    END IF;
  END LOOP;
END $$;

COMMIT;
