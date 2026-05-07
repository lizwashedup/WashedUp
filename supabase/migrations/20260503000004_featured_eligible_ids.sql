-- get_featured_eligible_ids: returns the uuids of featured events the
-- requesting user is allowed to see. Hybrid filter approach — the client
-- keeps its existing rich .from('events').select(...) query (with creator
-- + attendees joins) and chains .in('id', featuredIds) against this list,
-- so we don't have to duplicate the denormalized return shape into an RPC.
--
-- Visibility rules mirror get_filtered_feed exactly EXCEPT:
--   * Adds e.is_featured = true.
--   * Does NOT apply the role='guest' joined-as-guest exclusion. Featured
--     plans have no capacity limit and stay visible to anyone who passes
--     the demographic filters, including users who joined as guest. They
--     can still see (and revisit) the featured event in the carousel.
--   * Does NOT apply creator_user_id != p_user_id. Consistent with the
--     post-Prompt-1 feed behavior — creators see their own plans.
--
-- Why an RPC: gender / age / blocks all need server-side info (the user's
-- own profile + the mutual_blocks union). Filtering client-side would leak
-- ineligible plans into the carousel before the JS check runs.

CREATE OR REPLACE FUNCTION public.get_featured_eligible_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_gender gender_type;
  v_user_age INTEGER;
  v_blocked_users UUID[];
  v_ids uuid[];
BEGIN
  SELECT p.gender, calculate_age(p.birthday), p.blocked_users
  INTO v_user_gender, v_user_age, v_blocked_users
  FROM profiles p
  WHERE p.id = p_user_id;

  WITH mutual_blocks AS (
    SELECT bp.id AS blocked_id
    FROM profiles bp
    WHERE p_user_id = ANY(bp.blocked_users)
    UNION
    SELECT unnest(COALESCE(v_blocked_users, ARRAY[]::UUID[]))
      AS blocked_id
  )
  SELECT array_agg(e.id)
  INTO v_ids
  FROM events e
  WHERE
    e.is_featured = true
    AND e.status IN ('forming', 'active', 'full')
    AND e.start_time > NOW() - INTERVAL '3 hours'
    AND e.creator_user_id NOT IN (SELECT blocked_id FROM mutual_blocks)
    AND NOT EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id = e.id
        AND em.status = 'joined'
        AND em.user_id IN (SELECT blocked_id FROM mutual_blocks)
    )
    AND NOT EXISTS (
      SELECT 1 FROM event_waitlist ew
      WHERE ew.event_id = e.id
        AND ew.user_id IN (SELECT blocked_id FROM mutual_blocks)
    )
    AND (
      e.gender_rule = 'mixed'
      OR (e.gender_rule = 'women_only' AND v_user_gender = 'woman')
      OR (e.gender_rule = 'men_only' AND v_user_gender = 'man')
      OR (e.gender_rule = 'nonbinary_only'
          AND v_user_gender = 'non_binary')
    )
    AND (e.target_age_min IS NULL
         OR v_user_age >= e.target_age_min)
    AND (e.target_age_max IS NULL
         OR v_user_age <= e.target_age_max);

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- Self-tests
-- ────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_def text;
  v_fn_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_featured_eligible_ids'
  ) INTO v_fn_exists;

  IF NOT v_fn_exists THEN
    RAISE EXCEPTION 'self-test failed: get_featured_eligible_ids function missing';
  END IF;

  SELECT pg_get_functiondef('public.get_featured_eligible_ids(uuid)'::regprocedure)
  INTO v_def;

  -- Confirm it actually applies the gender + age filters (the bug we set
  -- out to fix). If someone "fixes" the RPC later by stripping these,
  -- subsequent applies fail loud.
  IF position('gender_rule' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_featured_eligible_ids does not filter by gender_rule';
  END IF;

  IF position('target_age_min' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_featured_eligible_ids does not filter by target_age_min';
  END IF;

  IF position('mutual_blocks' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_featured_eligible_ids does not filter by mutual_blocks';
  END IF;
END
$do$;
