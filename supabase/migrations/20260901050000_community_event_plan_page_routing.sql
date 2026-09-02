-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
--
-- community_event_plan_page_routing (2026-09-01)
--
-- Liz's 2026-09-01 call decision (transcript-verified, see
-- LIZ-OPEN-QUESTIONS.md "Community event routing to the Plan page"): a
-- community event should behave like an Organization event for Plan-page
-- purposes, including a roughly-8-person cap, rather than building separate
-- community-to-Plan-page routing. Today it does neither. Community (and
-- organization) events live entirely in explore_events, a structurally
-- different table with a different status vocabulary ('Live'/'Draft') that
-- get_filtered_feed has never had any awareness of at all -- this is bigger
-- than the single WHERE-clause tweak it first looked like.
--
-- Scope of this migration, on purpose:
--   - Only COMMUNITY-owned explore_events (community_id is not null) are
--     added to the Plan feed. Organization-owned explore_events are left
--     alone -- they're expected to eventually get their own real
--     ticket_capacity-based cap once 20260817130000_explore_event_rsvp_capacity.sql
--     (itself still a draft, unapplied) lands, and mixing that shape in here
--     would conflate two differently-capped problems. Revisit together once
--     that migration is real.
--   - The cap is a flat, hardcoded 8 (matching Liz's own words on the call --
--     "make the cap eight"), independent of explore_events.ticket_capacity,
--     which does not exist in production yet.
--   - "Going" count comes from the existing, already-live explore_event_rsvps
--     table (status = 'going'), the same mechanism the RSVP-capacity draft
--     migration itself reads from. Verified live via
--     20260706150000_mvp_batch.sql, not assumed.
--   - Fields explore_events has no equivalent for are defaulted, not guessed
--     per-row: gender_rule 'mixed' (open to everyone, no gate), no age gate,
--     no host_message, no slug, no featured flag, no clustering (each
--     community event stands alone, never merged into a duplicate cluster).
--   - location: explore_events.latitude/longitude (added by
--     20260713001757_event_coordinates_proposal_35.sql, double precision --
--     explicitly cast to numeric below to match this function's declared
--     return shape) are used directly, so Near Me distance filtering works
--     for these rows like any other plan; a community event with no
--     coordinates on file simply won't surface under an active Near Me
--     radius, same as any existing plan missing coordinates today.
--   - Deliberately NOT replicated for these rows: the Plan-specific
--     already-joined-as-guest exclusion and event_waitlist exclusion --
--     explore_events has its own separate RSVP flow, not the Plan
--     join/waitlist mechanism, so those tables have nothing to join against.
--   - member_count returned here is already the real going-count. The
--     client's separate get_event_joined_counts correction RPC only knows
--     about event_members and will simply find no match for an
--     explore_event id, so fetchPlans.ts's existing
--     `realCounts[p.id] ?? p.member_count` fallback keeps this value
--     untouched -- confirmed by reading that fallback in lib/fetchPlans.ts,
--     not assumed.
--
-- This CREATE OR REPLACE reproduces the LIVE prod definition of
-- get_filtered_feed(uuid,numeric,numeric,numeric) verbatim (from
-- 20260609140300_get_filtered_feed_circle_aware.sql) and adds exactly one
-- additive branch: a UNION ALL of eligible community explore_events into
-- the `raw` CTE, using the exact same column list and order so every
-- downstream clause (visible, ordering, clustering) is untouched. Every
-- existing Plan row's own behavior is unaffected in principle -- run the
-- same before/after byte-identical regression check that migration's own
-- header describes, for a user with no community events in radius, before
-- ever applying this for real.
--
-- NOT TESTED AGAINST A REAL DATABASE. The disposable local harness is down
-- tonight for an unrelated reason. Review the field mapping above
-- carefully and run this against a prod clone or the harness once it's
-- back, before this ever applies for real.

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
    -- See header for exactly what is and isn't replicated for these rows.
    SELECT ee.id, ee.title, ee.description, ee.venue_address AS location_text,
      ee.latitude::numeric AS location_lat, ee.longitude::numeric AS location_lng, ee.start_time,
      (CASE WHEN v_going.n >= 8 THEN 'full' ELSE 'active' END)::text AS status,
      v_going.n AS member_count, 7::integer AS max_invites, ee.category AS primary_vibe,
      'mixed'::text AS gender_rule, NULL::integer AS target_age_min, NULL::integer AS target_age_max,
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
-- Self-test: the function executes for a real user under a real jwt and
-- returns without error. Read-only; nothing to roll back. This has NOT been
-- run against a real database tonight (harness down) -- read it, don't
-- trust it blindly.
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
