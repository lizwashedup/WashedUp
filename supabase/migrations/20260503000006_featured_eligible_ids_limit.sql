-- Defensive cap on get_featured_eligible_ids.
--
-- Featured plans are admin-flagged with no count constraint. Today there's
-- one featured event on prod; if a future admin sweep ever flips many
-- events to is_featured=true, this RPC would materialize an unbounded
-- uuid[] every time the plans tab mounts. Cap at 200 to bound memory and
-- network — a featured carousel never renders that many anyway.
--
-- Body otherwise byte-identical to 20260503000004_featured_eligible_ids.

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
  ),
  picked AS (
    SELECT e.id
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
           OR v_user_age <= e.target_age_max)
    ORDER BY e.start_time ASC
    LIMIT 200
  )
  SELECT array_agg(picked.id)
  INTO v_ids
  FROM picked;

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$;

DO $do$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.get_featured_eligible_ids(uuid)'::regprocedure) INTO v_def;

  IF position('LIMIT 200' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_featured_eligible_ids missing LIMIT 200 cap (unbounded array_agg risk)';
  END IF;

  -- Sanity: filters from the prior migration must still be present.
  IF position('gender_rule' IN v_def) = 0
     OR position('target_age_min' IN v_def) = 0
     OR position('mutual_blocks' IN v_def) = 0
  THEN
    RAISE EXCEPTION
      'self-test failed: get_featured_eligible_ids lost a required filter during the LIMIT add';
  END IF;
END
$do$;
