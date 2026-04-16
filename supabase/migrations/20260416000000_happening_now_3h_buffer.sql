-- Widen get_filtered_feed time window so plans linger in the feed for
-- 3 hours after start_time. Paired with the client-side 3h buffer on
-- featured/my-plans filters. Keeps users from losing access to a plan's
-- chat + join button the instant start_time passes.

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
  SELECT p.gender, calculate_age(p.birthday), p.vibe_tags, p.city, p.blocked_users
  INTO v_user_gender, v_user_age, v_user_vibes, v_user_city, v_blocked_users
  FROM profiles p
  WHERE p.id = p_user_id;

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.location_text,
    e.location_lat, e.location_lng, e.start_time,
    e.status::text, e.member_count, e.max_invites,
    e.primary_vibe, e.gender_rule::text, e.target_age_min, e.target_age_max,
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
  JOIN profiles host_profile ON e.creator_user_id = host_profile.id
  WHERE
    e.status IN ('forming', 'active', 'full')
    AND e.start_time > NOW() - INTERVAL '3 hours'
    AND e.creator_user_id != p_user_id
    AND NOT (e.creator_user_id = ANY(COALESCE(v_blocked_users, ARRAY[]::UUID[])))
    AND NOT (p_user_id = ANY(COALESCE(host_profile.blocked_users, ARRAY[]::UUID[])))
    AND (
      NOT EXISTS (
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
        OR (e.gender_rule = 'nonbinary_only' AND v_user_gender = 'non_binary')
      )
      AND (e.target_age_min IS NULL OR v_user_age >= e.target_age_min)
      AND (e.target_age_max IS NULL OR v_user_age <= e.target_age_max)
    )
  ORDER BY e.start_time ASC;
END;
$function$;
