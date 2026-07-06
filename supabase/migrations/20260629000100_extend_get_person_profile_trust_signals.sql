-- WS-3 (Wave 1): extend get_person_profile with trust signals.
-- Adds bio, vibe_tags, neighborhood, phone_verified, joined_at, plans_created (viewer-visible),
-- mutual_count + mutual_faces (block-aware both ways), is_new (recency AND <3 plans).
-- CREATE OR REPLACE preserves grants. Mutual gate + just-us-circle exclusion unchanged.
-- Applied to prod 2026-06-29 (verified: mutual gate NULL, just-us excluded, is_new=false for established user).

CREATE OR REPLACE FUNCTION public.get_person_profile(p_target uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_viewer uuid := auth.uid(); v_result jsonb;
BEGIN
  IF v_viewer IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF p_target IS NULL
     OR public.yours_is_blocked_between(v_viewer, p_target)
     OR NOT public.yours_is_connected(v_viewer, p_target) THEN
    RETURN NULL;
  END IF;
  WITH base AS (
    SELECT e.id, e.title, e.start_time, e.neighborhood, e.location_text, e.status
    FROM public.event_members em JOIN public.events e ON e.id = em.event_id
    WHERE em.user_id = p_target AND em.status = 'joined'
      AND e.status NOT IN ('cancelled','draft')
      AND public.event_circle_visible_to(e.circle_id, e.circle_visibility, v_viewer)
      AND public.is_plan_visible_to(p_target, v_viewer)
  ),
  up AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id',b.id,'title',b.title,
        'start_time',b.start_time,'neighborhood',b.neighborhood) ORDER BY b.start_time ASC),'[]'::jsonb) AS j,
      count(*) AS n
    FROM base b WHERE b.start_time >= now() AND b.status IN ('forming','active','full')
  ),
  past_ranked AS (
    SELECT b.id,b.title,b.start_time,count(*) OVER () AS total,
           row_number() OVER (ORDER BY b.start_time DESC) AS rn
    FROM base b WHERE b.start_time < now()
  ),
  pa AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id',pr2.id,'title',pr2.title,
        'date',pr2.start_time) ORDER BY pr2.start_time DESC) FILTER (WHERE pr2.rn<=10),'[]'::jsonb) AS j,
      COALESCE(max(pr2.total),0) AS total
    FROM past_ranked pr2
  ),
  mutuals AS (
    SELECT DISTINCT vc.oid FROM (
      SELECT CASE WHEN pc.requester_user_id=v_viewer THEN pc.recipient_user_id ELSE pc.requester_user_id END AS oid
      FROM public.people_connections pc
      WHERE pc.status='accepted' AND v_viewer IN (pc.requester_user_id,pc.recipient_user_id)
    ) vc
    WHERE vc.oid<>p_target AND vc.oid<>v_viewer
      AND public.yours_is_connected(vc.oid,p_target)
      AND NOT public.yours_is_blocked_between(v_viewer,vc.oid)
      AND NOT public.yours_is_blocked_between(p_target,vc.oid)
  ),
  mutuals_ranked AS (
    SELECT mp.id,mp.first_name_display,mp.profile_photo_url,
           row_number() OVER (ORDER BY mp.first_name_display) AS rn, count(*) OVER () AS total
    FROM mutuals m JOIN public.profiles mp ON mp.id=m.oid
  ),
  mf AS (
    SELECT COALESCE(max(mr.total),0) AS n,
      COALESCE(jsonb_agg(jsonb_build_object('user_id',mr.id,'first_name_display',mr.first_name_display,
        'profile_photo_url',mr.profile_photo_url) ORDER BY mr.rn) FILTER (WHERE mr.rn<=3),'[]'::jsonb) AS faces
    FROM mutuals_ranked mr
  ),
  pc_created AS (
    SELECT count(*) AS n FROM public.events e
    WHERE e.creator_user_id=p_target AND e.status NOT IN ('cancelled','draft')
      AND public.event_circle_visible_to(e.circle_id,e.circle_visibility,v_viewer)
      AND public.is_plan_visible_to(p_target,v_viewer)
  ),
  np AS (
    SELECT count(*) AS n FROM public.event_members em JOIN public.events e ON e.id=em.event_id
    WHERE em.user_id=p_target AND em.status='joined' AND e.status NOT IN ('cancelled','draft')
  )
  SELECT jsonb_build_object(
    'user_id',pr.id,'first_name_display',pr.first_name_display,
    'profile_photo_url',pr.profile_photo_url,'handle',pr.handle,
    'bio',pr.bio,
    'vibe_tags',COALESCE(to_jsonb(pr.vibe_tags),'[]'::jsonb),
    'neighborhood',pr.neighborhood,
    'phone_verified',COALESCE(pr.phone_verified,false),
    'joined_at',pr.created_at,
    'plans_created',(SELECT n FROM pc_created),
    'mutual_count',(SELECT n FROM mf),
    'mutual_faces',(SELECT faces FROM mf),
    'is_new',(pr.created_at > now() - interval '30 days' AND (SELECT n FROM np) < 3),
    'upcoming',(SELECT j FROM up),'upcoming_count',(SELECT n FROM up),
    'past',(SELECT j FROM pa),'past_total',(SELECT total FROM pa)
  ) INTO v_result FROM public.profiles pr WHERE pr.id=p_target;
  RETURN v_result;
END; $function$;
