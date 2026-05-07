-- get_filtered_feed: add cluster_root_id (filter-aware) so the feed query
-- itself decides whether a row belongs to a "popular plan" cluster.
--
-- Body otherwise byte-identical to the post-Prompt-1 version live on prod
-- (verified via pg_get_functiondef on 2026-05-03). The only behavioral
-- change is the new trailing return column.
--
-- Cluster detection is filter-aware: a women-only original duplicated as
-- mixed-gender is a lineage of 2 in raw schema, but to a man only the
-- mixed duplicate is visible. cluster_root_id is set to the lineage root
-- only when ≥2 rows survive the WHERE clause for THIS user; otherwise it's
-- NULL and the client renders the row as a standalone card.
--
-- Implementation:
--   1. CTE `visible` runs the existing filters and computes raw_root_id
--      per row via the new get_event_root helper.
--   2. Outer SELECT uses COUNT(*) OVER (PARTITION BY raw_root_id) to size
--      each lineage in the visible set, gating the final cluster_root_id.

-- ────────────────────────────────────────────────────────────────────
-- Lineage root helper (used only here; get_plan_lineage in migration A
-- returns the full set, this returns just the root scalar).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_root(p_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH RECURSIVE up AS (
    SELECT id, duplicated_from_event_id FROM events WHERE id = p_event_id
    UNION ALL
    SELECT e.id, e.duplicated_from_event_id
    FROM events e
    JOIN up ON e.id = up.duplicated_from_event_id
  )
  SELECT id FROM up WHERE duplicated_from_event_id IS NULL;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- get_filtered_feed (replace; new trailing column)
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_filtered_feed(uuid);

CREATE OR REPLACE FUNCTION public.get_filtered_feed(p_user_id uuid)
 RETURNS TABLE(
   id uuid, title text, description text, location_text text,
   location_lat numeric, location_lng numeric, start_time timestamp with time zone,
   status text, member_count integer, max_invites integer,
   primary_vibe text, gender_rule text,
   target_age_min integer, target_age_max integer,
   host_id uuid, host_name text, host_photo text, host_age_group text,
   spots_remaining integer, city text, host_message text, image_url text,
   slug text, neighborhood text, is_featured boolean,
   cluster_root_id uuid
 )
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
  ),
  visible AS (
    SELECT
      e.id, e.title, e.description, e.location_text,
      e.location_lat, e.location_lng, e.start_time,
      e.status::text AS status,
      e.member_count, e.max_invites,
      e.primary_vibe,
      e.gender_rule::text AS gender_rule,
      e.target_age_min, e.target_age_max,
      pp.id AS host_id,
      pp.first_name_display AS host_name,
      pp.profile_photo_url AS host_photo,
      pp.age_group AS host_age_group,
      (e.max_invites + 1 - e.member_count)::INTEGER AS spots_remaining,
      e.city, e.host_message, e.image_url,
      e.slug, e.neighborhood,
      e.is_featured,
      get_event_root(e.id) AS raw_root_id
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
  )
  SELECT
    v.id, v.title, v.description, v.location_text,
    v.location_lat, v.location_lng, v.start_time,
    v.status, v.member_count, v.max_invites,
    v.primary_vibe, v.gender_rule,
    v.target_age_min, v.target_age_max,
    v.host_id, v.host_name, v.host_photo, v.host_age_group,
    v.spots_remaining, v.city, v.host_message, v.image_url,
    v.slug, v.neighborhood, v.is_featured,
    -- get_event_root returns the event's own id for standalone events
    -- (no parent, no children) — those partitions have COUNT=1, so the
    -- CASE returns NULL and the client renders them as standalone cards.
    -- A genuine 2+-member visible lineage gets the actual root id.
    CASE
      WHEN COUNT(*) OVER (PARTITION BY v.raw_root_id) >= 2 THEN v.raw_root_id
      ELSE NULL
    END AS cluster_root_id
  FROM visible v
  ORDER BY v.start_time ASC;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- Self-tests
-- ────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_def text;
  v_root_fn_exists boolean;
BEGIN
  SELECT pg_get_functiondef('public.get_filtered_feed(uuid)'::regprocedure)
  INTO v_def;

  IF position('cluster_root_id' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_filtered_feed return type does not include cluster_root_id';
  END IF;

  IF position('creator_user_id != p_user_id' IN v_def) > 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_filtered_feed regressed the Prompt-1 fix (creator-self exclusion came back)';
  END IF;

  IF position('role = ''guest''' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_filtered_feed lost the role=''guest'' joined exclusion (would leak joined plans into feed)';
  END IF;

  IF position('get_event_root' IN v_def) = 0 THEN
    RAISE EXCEPTION
      'self-test failed: get_filtered_feed does not call get_event_root (cluster grouping broken)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_event_root'
  ) INTO v_root_fn_exists;

  IF NOT v_root_fn_exists THEN
    RAISE EXCEPTION 'self-test failed: get_event_root function missing';
  END IF;
END
$do$;
