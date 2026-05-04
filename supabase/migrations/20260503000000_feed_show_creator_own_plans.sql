-- get_filtered_feed: show the user's own created plans inline in the feed.
--
-- Previously the RPC had two filters that combined to hide every event the
-- signed-in user was associated with:
--   (a) AND e.creator_user_id != p_user_id      -- hid creator's own plans
--   (b) NOT EXISTS (... role='guest' ...)       -- hid plans joined as guest
--
-- Filter (b) is already scoped to role='guest' — it never matched the
-- creator's own host row in event_members — so removing filter (a) alone
-- yields the desired behavior:
--   • Creator's own plans                  → shown in feed (was hidden)
--   • Plans joined as guest                → still hidden (unchanged)
--   • Unrelated plans                      → still shown (unchanged)
--
-- Body otherwise identical to the prod capture in
-- 20260416000000_happening_now_3h_buffer.sql (verified via
-- pg_get_functiondef('get_filtered_feed'::regproc) on 2026-05-03).
--
-- DB-only fix; lib/fetchPlans.ts is unchanged. The "My Plans" tab fetch in
-- app/(tabs)/plans/index.tsx is independent and untouched.

DROP FUNCTION IF EXISTS public.get_filtered_feed(uuid);

CREATE OR REPLACE FUNCTION public.get_filtered_feed(p_user_id uuid)
 RETURNS TABLE(id uuid, title text, description text, location_text text, location_lat numeric, location_lng numeric, start_time timestamp with time zone, status text, member_count integer, max_invites integer, primary_vibe text, gender_rule text, target_age_min integer, target_age_max integer, host_id uuid, host_name text, host_photo text, host_age_group text, spots_remaining integer, city text, host_message text, image_url text, slug text, neighborhood text, is_featured boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_gender gender_type;
  v_user_age INTEGER;
  v_user_vibes TEXT[];
  v_user_city TEXT;
  v_blocked_users UUID[];
BEGIN
  SELECT p.gender, calculate_age(p.birthday), p.vibe_tags, p.city,
         p.blocked_users
  INTO v_user_gender, v_user_age, v_user_vibes, v_user_city,
       v_blocked_users
  FROM profiles p
  WHERE p.id = p_user_id;

  RETURN QUERY
  WITH mutual_blocks AS (
    SELECT bp.id AS blocked_id
    FROM profiles bp
    WHERE p_user_id = ANY(bp.blocked_users)
    UNION
    SELECT unnest(COALESCE(v_blocked_users, ARRAY[]::UUID[]))
      AS blocked_id
  )
  SELECT
    e.id, e.title, e.description, e.location_text,
    e.location_lat, e.location_lng, e.start_time,
    e.status::text, e.member_count, e.max_invites,
    e.primary_vibe, e.gender_rule::text,
    e.target_age_min, e.target_age_max,
    pp.id AS host_id,
    pp.first_name_display AS host_name,
    pp.profile_photo_url AS host_photo,
    pp.age_group AS host_age_group,
    (e.max_invites + 1 - e.member_count)::INTEGER AS spots_remaining,
    e.city, e.host_message, e.image_url,
    e.slug, e.neighborhood,
    e.is_featured
  FROM events e
  JOIN profiles_public pp ON e.creator_user_id = pp.id
  WHERE
    e.status IN ('forming', 'active', 'full')
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
    AND NOT EXISTS (
      SELECT 1 FROM event_members em
      WHERE em.event_id = e.id
        AND em.user_id = p_user_id
        AND em.role = 'guest'
        AND em.status = 'joined'
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
  ORDER BY e.start_time ASC;
END;
$function$;

-- Self-test: assert the new definition has the intended shape. Aborts the
-- migration if either guard fails (Supabase branches are broken, so we
-- substitute embedded checks for branch-deploy validation).
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.get_filtered_feed(uuid)'::regprocedure);
BEGIN
  IF position('creator_user_id != p_user_id' IN v_def) > 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_filtered_feed still contains the creator-self exclusion that this migration was supposed to remove';
  END IF;

  IF position('role = ''guest''' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_filtered_feed no longer excludes role=''guest'' joined plans — over-deleted, would leak joined plans into the feed';
  END IF;
END
$do$;
