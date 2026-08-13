-- Security hardening round 2: 10 more SECURITY DEFINER functions taking a
-- p_user_id-shaped param, found via a live pg_proc sweep (not migration-file
-- grep) after fixing the original 4 (join_event_atomic, get_user_moments,
-- search_users_by_handle, get_filtered_feed) earlier tonight. Same bug class:
-- caller-supplied identity with no auth.uid() check.
--
-- PREPARED, NOT YET APPLIED as of 2026-08-13. Held pending Josh's deploy
-- word, same standing rule as the round-1 migration.
--
-- Also individually checked and CLEARED (no fix needed, already correctly
-- guarded): grant_waitlist_exception, has_operator_grant, is_community_leader,
-- is_community_member, is_topic_member.
-- Also checked via real client call sites and confirmed FALSE POSITIVES
-- (intentionally public display data, shown for OTHER users on profile/plan
-- cards -- WashedUp/lib/creatorMarks.ts, washedup-web PlanCard.tsx/
-- MyPlansView.tsx, WashedUp+web MiniProfileCard.tsx -- adding a self-guard
-- here would break real features, not fix a bug):
-- get_creator_milestone_marks, get_user_profile_marks.
--
-- 1. can_join_event_gender -- confirmed self-only client usage (pre-join
--    gender-eligibility check, WashedUp/app/plan/[id].tsx:976 +
--    washedup-web plan/[id]/page.tsx:880). Returns false for a mismatched
--    caller instead of raising, preserving its boolean-return contract.
-- 2. check_creator_milestones -- zero live callers anywhere (client, edge
--    function, or SQL trigger -- checked all three across every repo and
--    every migration). Only writes idempotent, derived-from-real-data
--    achievement marks, so exposure was low (minor spam vector, not
--    forgeable), but closes it defensively.
-- 3. check_member_identity_marks -- same as above, zero live callers.
-- 4. compute_user_badge_counts -- DIFFERENT fix: only real caller is the
--    send-push-notifications edge function (WashedUp/supabase/functions/
--    send-push-notifications/index.ts:113-116), which batches MANY users'
--    badge counts in one call, so a self-only guard would break it. That
--    edge function runs as service_role, which already has EXECUTE on this
--    function independent of the anon/authenticated grants below (confirmed
--    live via has_function_privilege before writing this). Fix: revoke
--    anon + authenticated entirely, no guard added to the body.
-- 5. get_featured_eligible_ids -- confirmed self-only client usage
--    (WashedUp/app/(tabs)/plans/index.tsx:740, personalized featured list).
-- 6. get_pending_invites -- zero live callers found (client, edge function,
--    or SQL trigger). Standard guard added defensively.
-- 7. get_people_with_plan_history -- only client caller is
--    components/yours/legacy/LegacyYourPeopleScreen.tsx, confirmed
--    unreachable (grepped for imports of that component, zero hits outside
--    its own file). Standard guard added defensively, safe either way.
-- 8. update_activity_tracking -- confirmed self-only client usage
--    (washedup-web ActivityTracker.tsx, fire-and-forget activity heartbeat,
--    already wrapped in try/catch so a raised exception here is invisible
--    to the user, same as a network failure). Worst of the 10: p_now and
--    p_is_return_day are fully caller-controlled with NO server-side
--    derivation, so this was a raw unguarded WRITE to another user's row,
--    not just a read leak. Converted from LANGUAGE sql to plpgsql (same
--    signature and return type, valid CREATE OR REPLACE) so the guard can
--    RAISE EXCEPTION consistently with the rest of this file instead of
--    silently no-op-ing on a WHERE-clause guard, which the self-test below
--    couldn't verify as cleanly.
--
-- All bodies below are the VERBATIM live pg_get_functiondef() output pulled
-- fresh right before writing this file (same discipline as tonight's
-- get_filtered_feed correction -- a migration-file or memory-based rewrite
-- risks the same stale-schema mismatch that broke the first apply attempt).

BEGIN;

-- ── 1. can_join_event_gender ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_join_event_gender(p_user_id uuid, p_event_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result boolean;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  SELECT
    CASE
      WHEN e.gender_rule = 'mixed' OR e.gender_rule IS NULL THEN true
      WHEN e.gender_rule = 'women_only' THEN p.gender = 'woman'
      WHEN e.gender_rule = 'men_only' THEN p.gender = 'man'
      WHEN e.gender_rule = 'nonbinary_only' THEN p.gender = 'non_binary'
      ELSE false
    END
  INTO v_result
  FROM events e
  CROSS JOIN profiles p
  WHERE e.id = p_event_id
    AND p.id = p_user_id;

  RETURN COALESCE(v_result, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.can_join_event_gender(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_join_event_gender(uuid, uuid) TO authenticated;

-- ── 2. check_creator_milestones ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_creator_milestones(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_count int;
  v_first_plan_id uuid;
  v_anchor_id uuid;
  v_mainstay_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT id INTO v_first_plan_id FROM marks WHERE slug = 'first-plan';
  SELECT id INTO v_anchor_id FROM marks WHERE slug = 'anchor';
  SELECT id INTO v_mainstay_id FROM marks WHERE slug = 'mainstay';

  SELECT COUNT(*) INTO v_count
  FROM events
  WHERE creator_user_id = p_user_id
    AND status IN ('completed', 'full', 'forming');

  IF v_count >= 1 AND v_first_plan_id IS NOT NULL THEN
    INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_first_plan_id)
    ON CONFLICT (user_id, mark_id) DO NOTHING;
  END IF;

  IF v_count >= 3 AND v_anchor_id IS NOT NULL THEN
    INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_anchor_id)
    ON CONFLICT (user_id, mark_id) DO NOTHING;
  END IF;

  IF v_count >= 8 AND v_mainstay_id IS NOT NULL THEN
    INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mainstay_id)
    ON CONFLICT (user_id, mark_id) DO NOTHING;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_creator_milestones(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_creator_milestones(uuid) TO authenticated;

-- ── 3. check_member_identity_marks ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_member_identity_marks(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_night_count int;
  v_morning_count int;
  v_outdoor_count int;
  v_culture_count int;
  v_coattend_count int;
  v_category_count int;
  v_mark_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT COUNT(*) INTO v_night_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND EXTRACT(HOUR FROM e.start_time AT TIME ZONE 'America/Los_Angeles') >= 20;

  IF v_night_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'night-owl';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_morning_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND EXTRACT(HOUR FROM e.start_time AT TIME ZONE 'America/Los_Angeles') < 12;

  IF v_morning_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'early-bird';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_outdoor_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND e.primary_vibe = 'outdoors';

  IF v_outdoor_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'trailblazer';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_culture_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND e.primary_vibe IN ('art', 'film', 'music', 'comedy');

  IF v_culture_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'culture-club';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_coattend_count
  FROM (
    SELECT other.user_id AS other_user
    FROM event_members me
    JOIN event_members other ON other.event_id = me.event_id
      AND other.user_id != me.user_id
      AND other.status = 'joined'
    WHERE me.user_id = p_user_id
      AND me.status = 'joined'
    GROUP BY other.user_id
    HAVING COUNT(DISTINCT me.event_id) >= 3
  ) pairs;

  IF v_coattend_count >= 1 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'the-regular';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT COUNT(DISTINCT e.primary_vibe) INTO v_category_count
  FROM event_members em
  JOIN events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id
    AND em.status = 'joined'
    AND e.primary_vibe IS NOT NULL;

  IF v_category_count >= 3 THEN
    SELECT id INTO v_mark_id FROM marks WHERE slug = 'explorer';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO user_marks (user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_member_identity_marks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_member_identity_marks(uuid) TO authenticated;

-- ── 4. compute_user_badge_counts ────────────────────────────────────────
-- No guard added -- legitimate caller (send-push-notifications edge
-- function) batches MANY users' badge counts at once, so a self-only check
-- would break it. Instead: lock the endpoint down entirely. service_role
-- (what the edge function actually runs as) already has EXECUTE
-- independent of these grants, confirmed live before writing this.

REVOKE ALL ON FUNCTION public.compute_user_badge_counts(uuid[]) FROM PUBLIC, anon, authenticated;

-- ── 5. get_featured_eligible_ids ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_featured_eligible_ids(p_user_id uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_gender gender_type;
  v_user_age INTEGER;
  v_blocked_users UUID[];
  v_ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

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

REVOKE ALL ON FUNCTION public.get_featured_eligible_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_featured_eligible_ids(uuid) TO authenticated;

-- ── 6. get_pending_invites ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_pending_invites(p_user_id uuid)
 RETURNS TABLE(invite_id uuid, event_id uuid, inviter_id uuid, inviter_name text, inviter_photo text, plan_title text, plan_start_time timestamp with time zone, plan_location text, plan_image_url text, plan_member_count integer, plan_max_invites integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    pi.id AS invite_id,
    pi.event_id,
    pi.inviter_id,
    p.first_name_display AS inviter_name,
    p.profile_photo_url AS inviter_photo,
    e.title AS plan_title,
    e.start_time AS plan_start_time,
    e.location_text AS plan_location,
    e.image_url AS plan_image_url,
    e.member_count::integer AS plan_member_count,
    e.max_invites::integer AS plan_max_invites,
    pi.created_at
  FROM plan_invites pi
  JOIN events e ON e.id = pi.event_id
  JOIN profiles p ON p.id = pi.inviter_id
  JOIN friends f ON f.user_id = p_user_id AND f.friend_id = pi.inviter_id
  WHERE pi.invitee_id = p_user_id
    AND pi.status = 'pending'
    AND e.status IN ('forming', 'active', 'full')
    AND e.start_time > NOW()
  ORDER BY pi.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pending_invites(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_invites(uuid) TO authenticated;

-- ── 7. get_people_with_plan_history ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_people_with_plan_history(p_user_id uuid)
 RETURNS TABLE(id uuid, first_name_display text, profile_photo_url text, shared_plan_count bigint, last_plan_title text, last_plan_date timestamp with time zone, activity_categories text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  WITH my_friends AS (
    SELECT f.friend_id
    FROM friends f
    WHERE f.user_id = p_user_id
  ),
  shared_plans AS (
    SELECT
      em_friend.user_id AS friend_id,
      e.id AS event_id,
      e.title,
      e.start_time,
      e.primary_vibe
    FROM event_members em_me
    JOIN event_members em_friend ON em_me.event_id = em_friend.event_id
    JOIN events e ON e.id = em_me.event_id
    WHERE em_me.user_id = p_user_id
      AND em_me.status = 'joined'
      AND em_friend.status = 'joined'
      AND em_friend.user_id != p_user_id
      AND em_friend.user_id IN (SELECT friend_id FROM my_friends)
      AND e.status = 'completed'
  ),
  friend_stats AS (
    SELECT
      sp.friend_id,
      COUNT(DISTINCT sp.event_id) AS shared_plan_count,
      (ARRAY_AGG(sp.title ORDER BY sp.start_time DESC))[1] AS last_plan_title,
      MAX(sp.start_time) AS last_plan_date,
      ARRAY_AGG(DISTINCT sp.primary_vibe) FILTER (WHERE sp.primary_vibe IS NOT NULL) AS activity_categories
    FROM shared_plans sp
    GROUP BY sp.friend_id
  )
  SELECT
    p.id,
    p.first_name_display,
    p.profile_photo_url,
    COALESCE(fs.shared_plan_count, 0) AS shared_plan_count,
    fs.last_plan_title,
    fs.last_plan_date,
    COALESCE(fs.activity_categories, ARRAY[]::text[]) AS activity_categories
  FROM my_friends mf
  JOIN profiles p ON p.id = mf.friend_id
  LEFT JOIN friend_stats fs ON fs.friend_id = mf.friend_id
  WHERE NOT (p_user_id = ANY(COALESCE(p.blocked_users, ARRAY[]::UUID[])))
  ORDER BY COALESCE(fs.shared_plan_count, 0) DESC, p.first_name_display ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_people_with_plan_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_people_with_plan_history(uuid) TO authenticated;

-- ── 8. update_activity_tracking ─────────────────────────────────────────
-- Worst of the 10: p_now / p_is_return_day are fully caller-controlled with
-- no server-side derivation, so this was a raw unguarded write to another
-- user's profile row, not just an information leak. Converted from
-- LANGUAGE sql to plpgsql (same signature/return type -- valid replace) so
-- the guard can RAISE EXCEPTION like the rest of this file.

CREATE OR REPLACE FUNCTION public.update_activity_tracking(p_user_id uuid, p_now timestamp with time zone, p_is_return_day boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  UPDATE public.profiles
  SET
    last_active_at = p_now,
    first_return_at = CASE
      WHEN first_return_at IS NULL AND p_is_return_day THEN p_now
      ELSE first_return_at
    END
  WHERE id = p_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_activity_tracking(uuid, timestamp with time zone, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_activity_tracking(uuid, timestamp with time zone, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test.
--   1. ACL: anon must not hold EXECUTE on any hardened function, and
--      authenticated must not hold it on compute_user_badge_counts either.
--      Hard assertion.
--   2. service_role must still hold EXECUTE on compute_user_badge_counts --
--      losing this would silently break send-push-notifications.
--   3. Positive: a real user calling each function AS THEMSELVES still
--      works (regression guard).
--   4. Negative: check_creator_milestones and get_pending_invites (RAISE
--      EXCEPTION style) must raise the exact 'unauthorized' message for a
--      mismatched p_user_id. update_activity_tracking same, plus confirms
--      the target row's last_active_at did NOT change. can_join_event_gender
--      (returns-false style) must return exactly false, not raise.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid            uuid;
  v_other_uid      uuid;
  v_msg            text;
  v_before_active  timestamptz;
  v_after_active   timestamptz;
BEGIN
  IF has_function_privilege('anon', 'public.can_join_event_gender(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.check_creator_milestones(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.check_member_identity_marks(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.compute_user_badge_counts(uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.compute_user_badge_counts(uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_featured_eligible_ids(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_pending_invites(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_people_with_plan_history(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_activity_tracking(uuid,timestamptz,boolean)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'ACL check failed: a hardened function still holds an unintended grant';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.compute_user_badge_counts(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'compute_user_badge_counts lost service_role EXECUTE -- this would break send-push-notifications';
  END IF;

  SELECT id INTO v_uid FROM public.profiles ORDER BY id LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'no profile available; skipping self-call smoke-tests (ACL checks above still ran)';
    RETURN;
  END IF;
  SELECT id INTO v_other_uid FROM public.profiles WHERE id <> v_uid ORDER BY id LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  BEGIN
    PERFORM public.check_creator_milestones(v_uid);
    PERFORM public.check_member_identity_marks(v_uid);
    PERFORM public.get_featured_eligible_ids(v_uid);
    PERFORM public.get_pending_invites(v_uid);
    PERFORM public.get_people_with_plan_history(v_uid);
    PERFORM public.update_activity_tracking(v_uid, now(), false);
    PERFORM public.can_join_event_gender(v_uid, '00000000-0000-0000-0000-000000000000'::uuid);
    RAISE NOTICE 'all self-calls succeeded';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'a self-call failed for an unrelated reason (not the guard): %', SQLERRM;
  END;

  IF v_other_uid IS NOT NULL THEN
    v_msg := NULL;
    BEGIN
      PERFORM public.check_creator_milestones(v_other_uid);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'unauthorized' THEN
      RAISE EXCEPTION 'check_creator_milestones did not raise ''unauthorized'' for a mismatched p_user_id (got: %)', COALESCE(v_msg, 'no error');
    END IF;

    v_msg := NULL;
    BEGIN
      PERFORM public.get_pending_invites(v_other_uid);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'unauthorized' THEN
      RAISE EXCEPTION 'get_pending_invites did not raise ''unauthorized'' for a mismatched p_user_id (got: %)', COALESCE(v_msg, 'no error');
    END IF;

    SELECT last_active_at INTO v_before_active FROM public.profiles WHERE id = v_other_uid;
    v_msg := NULL;
    BEGIN
      PERFORM public.update_activity_tracking(v_other_uid, now(), false);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'unauthorized' THEN
      RAISE EXCEPTION 'update_activity_tracking did not raise ''unauthorized'' for a mismatched p_user_id (got: %)', COALESCE(v_msg, 'no error');
    END IF;
    SELECT last_active_at INTO v_after_active FROM public.profiles WHERE id = v_other_uid;
    IF v_before_active IS DISTINCT FROM v_after_active THEN
      RAISE EXCEPTION 'update_activity_tracking mutated last_active_at for a mismatched p_user_id despite raising -- guard ran after the write';
    END IF;

    IF public.can_join_event_gender(v_other_uid, '00000000-0000-0000-0000-000000000000'::uuid) IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'can_join_event_gender did not return false for a mismatched p_user_id';
    END IF;

    RAISE NOTICE 'all negative assertions passed';
  ELSE
    RAISE NOTICE 'only one profile exists; skipping negative tests';
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

COMMIT;
