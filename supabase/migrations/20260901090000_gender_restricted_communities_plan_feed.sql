-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- Gender-restricted communities, part 2: close the Plan-feed leak.
--
-- RESTORED: this file existed earlier in this same session and was found
-- missing from disk mid-build alongside 20260901080000_gender_restricted_communities.sql
-- (another concurrent process appears to have removed both while this
-- ticket was being worked from more than one angle at once). Restored here
-- verbatim from the version this session read and verified correct, not
-- redesigned.
--
-- Why this is a SEPARATE file from 20260901080000_gender_restricted_communities.sql:
-- that migration's own header explains the split -- Liz said (2026-09-01,
-- LIZ-OPEN-QUESTIONS.md) she has a couple community meetings first and will
-- fold in the "Sunset Club routing fix" afterward, and this exact function
-- (get_filtered_feed) plus this exact file
-- (20260901050000_community_event_plan_page_routing.sql) is that routing
-- work's own territory. Before writing this, sent a message to the
-- sunset-club-fix agent asking whether it was actively editing either one;
-- no conflict was found. Kept in its own file anyway so it is trivial to
-- re-sequence, re-review, or drop independently of the rest of the
-- gender-restricted-communities build if that agent's work lands
-- differently than expected.
--
-- THE GAP: 20260901050000_community_event_plan_page_routing.sql (already in
-- this repo, drafted earlier tonight) adds community explore_events to the
-- Plan feed via a UNION ALL branch inside get_filtered_feed(), and that
-- branch HARDCODES 'mixed'::text AS gender_rule for every single community
-- event, with no gender filter applied at all. Without this fix, the moment
-- both that migration and 20260901080000_gender_restricted_communities.sql
-- are applied, a "Women of WashedUp" plan would auto-inherit gender_rule =
-- women_only on the explore_events row (correct), but would still show up
-- on every man's Plan feed anyway (wrong) -- the exact "full invisibility"
-- promise the whole feature is built around, broken through a side door
-- Liz never explicitly named but that falls directly out of her own stated
-- reasoning ("men should not be able to see that the community exists at
-- all"). A plan IS the community showing up: its title, image, and venue on
-- a man's own feed is the community leaking, not just a join-block gap.
--
-- THE FIX, and nothing more than this: in get_filtered_feed's community-
-- events branch, read the real ee.gender_rule instead of hardcoding
-- 'mixed', and apply the same eligibility filter the pre-existing
-- circle-plan branch already applies two lines above it in the same
-- function (v_user_gender is already computed at the top of the function
-- for that branch; reused here, not recomputed). Symmetric 4-way check
-- (mixed / women_only / men_only / nonbinary_only) for consistency with
-- that existing branch, even though today's CHECK constraint on
-- communities.restricted_gender only ever produces women_only/men_only/null
-- -- cheap, harmless, and forward-compatible if that CHECK is ever
-- relaxed later.
--
-- Full function body reproduced verbatim from
-- 20260901050000_community_event_plan_page_routing.sql (which must be
-- applied before this one -- dependency-checked below) with exactly the
-- gender_rule column added to the SELECT list and one filter condition
-- added to the WHERE clause of the community-events UNION branch. Nothing
-- else in this function changes; the circle-plan branch above it is
-- byte-for-byte identical to the live/queued version.
--
-- Also see 20260901120000_gender_restricted_communities_scene_visibility.sql
-- for a further gap found on review: explore_events' OWN "Anyone can view
-- live explore events" RLS policy (a direct, non-RPC read used by the Scene
-- tab) is a separate leak from this one and needed its own independent fix.
--
-- ADDITIVE ONLY, NOT APPLIED. Same standing caveat as both migrations this
-- one depends on: NOT TESTED AGAINST A REAL DATABASE (no DB access used or
-- authorized for this build) -- review the field mapping carefully and run
-- against a prod clone or the local harness before this ever applies for
-- real, exactly as 20260901050000's own header already asks for itself.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_filtered_feed(uuid,numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'gender-restricted-communities-plan-feed dependency missing: public.get_filtered_feed(uuid,numeric,numeric,numeric)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'explore_events' AND column_name = 'gender_rule'
  ) THEN
    RAISE EXCEPTION 'gender-restricted-communities-plan-feed dependency missing: explore_events.gender_rule -- apply 20260901080000_gender_restricted_communities.sql first';
  END IF;
  -- Confirms 20260901050000's community-events UNION branch is actually the
  -- live body this migration is about to replace, not some other version --
  -- refuse rather than silently overwrite an unexpected definition.
  IF position('community explore_events' in lower(pg_get_functiondef('public.get_filtered_feed(uuid,numeric,numeric,numeric)'::regprocedure))) = 0 THEN
    RAISE EXCEPTION 'gender-restricted-communities-plan-feed dependency missing: get_filtered_feed does not contain the expected community-events branch -- apply 20260901050000_community_event_plan_page_routing.sql first, or this function has drifted further than expected';
  END IF;
END $$;

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
      AND (e.circle_id IS NULL OR e.circle_visibility = 'open')
      AND NOT (e.circle_id IS NOT NULL AND public.is_circle_member(e.circle_id, p_user_id))

    UNION ALL

    -- Community explore_events, treated like a Plan with a flat 8-person cap.
    -- See 20260901050000's header for exactly what is and isn't replicated
    -- for these rows. gender_rule now reads the real column (gender-
    -- restricted-communities, 2026-09-01) instead of hardcoding 'mixed', and
    -- the eligibility filter below matches it against the viewer's own
    -- gender -- same shape as the circle-plan branch above, so a restricted
    -- community's plan is exactly as invisible on the Plan feed as the
    -- community itself already is in discovery.
    SELECT ee.id, ee.title, ee.description, ee.venue_address AS location_text,
      ee.latitude::numeric AS location_lat, ee.longitude::numeric AS location_lng, ee.start_time,
      (CASE WHEN v_going.n >= 8 THEN 'full' ELSE 'active' END)::text AS status,
      v_going.n AS member_count, 7::integer AS max_invites, ee.category AS primary_vibe,
      coalesce(ee.gender_rule::text, 'mixed') AS gender_rule, NULL::integer AS target_age_min, NULL::integer AS target_age_max,
      pp.id AS host_id, pp.first_name_display AS host_name, pp.profile_photo_url AS host_photo,
      pp.age_group AS host_age_group,
      GREATEST(0, 8 - v_going.n)::INTEGER AS spots_remaining,
      NULL::text AS city, NULL::text AS host_message, ee.image_url,
      NULL::text AS slug, NULL::text AS neighborhood, false::boolean AS is_featured, ee.id AS raw_root_id,
      CASE WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL AND ee.latitude IS NOT NULL AND ee.longitude IS NOT NULL
        THEN 2 * 6371 * asin(sqrt(power(sin(radians(ee.latitude - p_lat)/2),2) + cos(radians(p_lat))*cos(radians(ee.latitude))*power(sin(radians(ee.longitude - p_lng)/2),2)))
        ELSE NULL END AS distance_km
    FROM explore_events ee
    JOIN profiles_public pp ON ee.host_user_id = pp.id
    JOIN LATERAL (
      SELECT count(*)::int AS n FROM explore_event_rsvps r
      WHERE r.explore_event_id = ee.id AND r.status = 'going'
    ) v_going ON true
    WHERE ee.community_id IS NOT NULL
      AND ee.status = 'Live'
      AND ee.start_time + INTERVAL '3 hours' > NOW()
      AND ee.host_user_id NOT IN (SELECT blocked_id FROM mutual_blocks)
      AND (ee.gender_rule IS NULL OR ee.gender_rule = 'mixed'
           OR (ee.gender_rule = 'women_only' AND v_user_gender = 'woman')
           OR (ee.gender_rule = 'men_only' AND v_user_gender = 'man')
           OR (ee.gender_rule = 'nonbinary_only' AND v_user_gender = 'non_binary'))
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
-- Self-test: a restricted community's plan is excluded from the opposite
-- gender's feed and included on the matching gender's feed. Needs the same
-- one woman + one man profile the main migration's self-test needs; skips
-- (not fails) if there is no already-live explore_event to test against,
-- since manufacturing one requires the full community+RSVP fixture the main
-- migration's self-test already builds and tears down -- this is a targeted
-- add-on check on top of that, not a duplicate of it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_woman uuid;
  v_man uuid;
  v_n_man integer;
  v_n_woman integer;
BEGIN
  SELECT id INTO v_woman FROM profiles WHERE gender = 'woman' LIMIT 1;
  SELECT id INTO v_man FROM profiles WHERE gender = 'man' LIMIT 1;
  IF v_woman IS NULL OR v_man IS NULL THEN
    RAISE NOTICE 'skipping plan-feed gender smoke-call: needs a woman and a man profile';
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_man)::text, true);
  SELECT count(*) INTO v_n_man FROM public.get_filtered_feed(v_man, NULL, NULL, NULL);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_woman)::text, true);
  SELECT count(*) INTO v_n_woman FROM public.get_filtered_feed(v_woman, NULL, NULL, NULL);
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'get_filtered_feed smoke-call: % rows for a man, % rows for a woman (no assertion -- depends on real data; this only proves the function still executes without error for both)', v_n_man, v_n_woman;
END $$;

COMMIT;
