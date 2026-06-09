-- Circle-aware plans. 4/4: get_filtered_feed (the only shipped read-path change).
--
-- REVIEW ONLY. Not applied by the agent. APPLY LAST, after re-confirming the
-- prod body. This CREATE OR REPLACE reproduces the LIVE prod definition of
-- get_filtered_feed(uuid,numeric,numeric,numeric) verbatim (dumped 2026-06-09
-- from upstjumasqblszevlgik via pg_get_functiondef) and adds four additive
-- clauses. The RETURNS TABLE shape is UNCHANGED (no client type churn).
--
-- The four additions (everything else is byte-for-byte the prod body):
--   (a) include open circle plans / exclude circle_only:
--         AND (e.circle_id IS NULL OR e.circle_visibility = 'open')
--   (b) hide every circle plan from its own circle's members (they discover it
--       via the circle, never the feed):
--         AND NOT (e.circle_id IS NOT NULL AND public.is_circle_member(e.circle_id, p_user_id))
--   (c) spots_remaining: for a circle plan, GREATEST(0, stranger_cap - joined
--       strangers) (the count a feed viewer cares about); else the original
--       max_invites + 1 - member_count.
--   (d) the existing already-joined / blocks / gender / age / time / drop_in /
--       cluster / radius logic is untouched.
--
-- REGRESSION PROOF (mandatory, run at apply time on a prod clone or locally,
-- NOT documented here as a no-op assertion): capture get_filtered_feed output
-- for a normal NON-circle user before this replace, run again after, and
-- confirm the rows are byte-identical for users with no circle plans in scope.
-- Because circle plans do not exist until create_circle_plan is used, every
-- existing row has circle_id IS NULL, so (a) passes them, (b) is false, and (c)
-- takes the ELSE branch -> identical output. The self-test below only proves
-- the function executes; the byte-identical diff is a manual apply-time gate.
--
-- Idempotent. BEGIN/COMMIT with an execution smoke-test under a real jwt.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_filtered_feed(
  p_user_id uuid,
  p_lat numeric DEFAULT NULL::numeric,
  p_lng numeric DEFAULT NULL::numeric,
  p_radius_km numeric DEFAULT NULL::numeric
)
 RETURNS TABLE(id uuid, title text, description text, location_text text, location_lat numeric, location_lng numeric, start_time timestamp with time zone, status text, member_count integer, max_invites integer, primary_vibe text, gender_rule text, target_age_min integer, target_age_max integer, host_id uuid, host_name text, host_photo text, host_age_group text, spots_remaining integer, city text, host_message text, image_url text, slug text, neighborhood text, is_featured boolean, cluster_root_id uuid, distance_km double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_gender gender_type; v_user_age INTEGER; v_user_vibes TEXT[]; v_user_city TEXT; v_blocked_users UUID[];
BEGIN
  SELECT p.gender, calculate_age(p.birthday), p.vibe_tags, p.city, p.blocked_users
  INTO v_user_gender, v_user_age, v_user_vibes, v_user_city, v_blocked_users
  FROM profiles p WHERE p.id = p_user_id;
  RETURN QUERY
  WITH mutual_blocks AS (
    SELECT bp.id AS blocked_id FROM profiles bp WHERE p_user_id = ANY(bp.blocked_users)
    UNION SELECT unnest(COALESCE(v_blocked_users, ARRAY[]::UUID[])) AS blocked_id
  ),
  raw AS (
    SELECT e.id, e.title, e.description, e.location_text, e.location_lat, e.location_lng, e.start_time,
      e.status::text AS status, e.member_count, e.max_invites, e.primary_vibe, e.gender_rule::text AS gender_rule,
      e.target_age_min, e.target_age_max, pp.id AS host_id, pp.first_name_display AS host_name,
      pp.profile_photo_url AS host_photo, pp.age_group AS host_age_group,
      -- (c) circle plans report remaining STRANGER spots; normal plans unchanged.
      CASE WHEN e.circle_id IS NOT NULL THEN
        GREATEST(0, COALESCE(e.stranger_cap, 0) - (
          SELECT count(*)::int FROM event_members em2
          WHERE em2.event_id = e.id AND em2.status = 'joined'
            AND NOT public.is_circle_member(e.circle_id, em2.user_id)
        ))::INTEGER
      ELSE (e.max_invites + 1 - e.member_count)::INTEGER END AS spots_remaining,
      e.city, e.host_message, e.image_url,
      e.slug, e.neighborhood, e.is_featured, get_event_root(e.id) AS raw_root_id,
      CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND e.location_lat IS NOT NULL AND e.location_lng IS NOT NULL
        THEN 2 * 6371 * asin(sqrt(power(sin(radians(e.location_lat - p_lat)/2),2) + cos(radians(p_lat))*cos(radians(e.location_lat))*power(sin(radians(e.location_lng - p_lng)/2),2)))
        ELSE NULL END AS distance_km
    FROM events e JOIN profiles_public pp ON e.creator_user_id = pp.id
    WHERE e.status IN ('forming','active','full')
      AND COALESCE(e.end_time, e.start_time + INTERVAL '3 hours') > NOW()
      AND (COALESCE(e.drop_in, true) = true OR e.start_time > NOW())
      AND e.creator_user_id NOT IN (SELECT blocked_id FROM mutual_blocks)
      AND NOT EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.status='joined' AND em.user_id IN (SELECT blocked_id FROM mutual_blocks))
      AND NOT EXISTS (SELECT 1 FROM event_waitlist ew WHERE ew.event_id = e.id AND ew.user_id IN (SELECT blocked_id FROM mutual_blocks))
      AND NOT EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = p_user_id AND em.role='guest' AND em.status='joined')
      AND (e.gender_rule='mixed' OR (e.gender_rule='women_only' AND v_user_gender='woman') OR (e.gender_rule='men_only' AND v_user_gender='man') OR (e.gender_rule='nonbinary_only' AND v_user_gender='non_binary'))
      AND (e.target_age_min IS NULL OR v_user_age >= e.target_age_min)
      AND (e.target_age_max IS NULL OR v_user_age <= e.target_age_max)
      -- (a) include open circle plans, drop circle_only from the public feed.
      AND (e.circle_id IS NULL OR e.circle_visibility = 'open')
      -- (b) a circle's own members never see its plan in the public feed.
      AND NOT (e.circle_id IS NOT NULL AND public.is_circle_member(e.circle_id, p_user_id))
  ),
  visible AS (
    SELECT * FROM raw r
    WHERE p_radius_km IS NULL OR p_lat IS NULL OR p_lng IS NULL
       OR (r.distance_km IS NOT NULL AND r.distance_km <= p_radius_km)
  )
  SELECT v.id, v.title, v.description, v.location_text, v.location_lat, v.location_lng, v.start_time,
    v.status, v.member_count, v.max_invites, v.primary_vibe, v.gender_rule, v.target_age_min, v.target_age_max,
    v.host_id, v.host_name, v.host_photo, v.host_age_group, v.spots_remaining, v.city, v.host_message, v.image_url,
    v.slug, v.neighborhood, v.is_featured,
    CASE WHEN COUNT(*) OVER (PARTITION BY v.raw_root_id) >= 2 THEN v.raw_root_id ELSE NULL END AS cluster_root_id,
    v.distance_km
  FROM visible v
  ORDER BY
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND v.distance_km IS NULL THEN 1 ELSE 0 END ASC,
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND p_radius_km IS NOT NULL AND v.is_featured THEN 0 ELSE 1 END ASC,
    CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN v.distance_km END ASC NULLS LAST,
    v.start_time ASC;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Self-test: the function executes for a real user under a real jwt and returns
-- without error. (The byte-identical regression diff is a manual apply-time
-- gate, see header.) Read-only; nothing to roll back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid uuid;
  v_n   integer;
BEGIN
  SELECT id INTO v_uid FROM public.profiles WHERE blocked_users IS NOT NULL OR id IS NOT NULL LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'no profile available; skipping get_filtered_feed smoke-call';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);
  SELECT count(*) INTO v_n FROM public.get_filtered_feed(v_uid, NULL, NULL, NULL);
  RAISE NOTICE 'get_filtered_feed smoke-call returned % rows', v_n;
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

COMMIT;
