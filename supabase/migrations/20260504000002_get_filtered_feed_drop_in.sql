-- Replaces get_filtered_feed to honor end_time and drop_in.
--
-- Visibility rules (for non-members; chat / My Plans are unaffected):
--   * Plans past their end-time cutoff drop from the feed regardless of
--     drop_in. Cutoff = COALESCE(end_time, start_time + INTERVAL '3 hours').
--   * If drop_in = true (default), plans stay visible until that cutoff —
--     this is the existing "happening now" 3-hour grace window.
--   * If drop_in = false, the plan vanishes the moment start_time passes,
--     even if its end_time is later (one-shot moments like a movie).
--
-- Everything else in this function — return columns, blocks, gender / age
-- filters, member exclusion, cluster_root_id windowing — is byte-identical
-- to the prior prod definition retrieved on 2026-05-04.

CREATE OR REPLACE FUNCTION public.get_filtered_feed(p_user_id uuid)
 RETURNS TABLE(id uuid, title text, description text, location_text text, location_lat numeric, location_lng numeric, start_time timestamp with time zone, status text, member_count integer, max_invites integer, primary_vibe text, gender_rule text, target_age_min integer, target_age_max integer, host_id uuid, host_name text, host_photo text, host_age_group text, spots_remaining integer, city text, host_message text, image_url text, slug text, neighborhood text, is_featured boolean, cluster_root_id uuid)
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
      -- past-end cutoff (applies regardless of drop_in)
      AND COALESCE(e.end_time, e.start_time + INTERVAL '3 hours') > NOW()
      -- drop_in = false plans vanish the moment start_time passes
      AND (COALESCE(e.drop_in, true) = true OR e.start_time > NOW())
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
    CASE
      WHEN COUNT(*) OVER (PARTITION BY v.raw_root_id) >= 2 THEN v.raw_root_id
      ELSE NULL
    END AS cluster_root_id
  FROM visible v
  ORDER BY v.start_time ASC;
END;
$function$;
