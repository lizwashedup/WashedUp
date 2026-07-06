-- WS-3 (Wave 1): add upcoming_neighborhood to get_yours_grid for the People-list "in {hood}" line.
-- DROP+CREATE (RETURNS TABLE signature gains one column appended last). Everything else byte-unchanged.
-- GRANT reproduction: a DROP+CREATE on Supabase re-grants EXECUTE to anon via ALTER DEFAULT PRIVILEGES,
-- so REVOKE FROM PUBLIC is NOT enough — must also REVOKE FROM anon. Live ACL = authenticated + service_role.
-- Applied to prod 2026-06-29 (verified byte-unchanged both directions, anon_blocked=true).

DROP FUNCTION IF EXISTS public.get_yours_grid(uuid);
CREATE FUNCTION public.get_yours_grid(p_user_id uuid)
 RETURNS TABLE(user_id uuid, first_name_display text, profile_photo_url text, handle text,
   ring_bucket text, shared_count integer, milestone text, upcoming_event_id uuid,
   upcoming_title text, upcoming_start timestamptz, connected_at timestamptz,
   upcoming_neighborhood text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN RAISE EXCEPTION 'unauthorized'; END IF;
  RETURN QUERY
  WITH others AS (
    SELECT CASE WHEN pc.requester_user_id=p_user_id THEN pc.recipient_user_id ELSE pc.requester_user_id END AS oid,
           pc.created_at AS connected_at
    FROM public.people_connections pc
    WHERE pc.status='accepted' AND p_user_id IN (pc.requester_user_id,pc.recipient_user_id)
  ),
  enriched AS (
    SELECT o.oid,o.connected_at,
      public.yours_shared_completed_count(p_user_id,o.oid) AS cnt,
      public.yours_last_shared_completed(p_user_id,o.oid)  AS last_ts
    FROM others o WHERE NOT public.yours_is_blocked_between(p_user_id,o.oid)
  ),
  upcoming AS (
    SELECT e.id AS oid_event, em.user_id AS oid, e.id AS ev_id, e.title AS ev_title,
           e.start_time AS ev_start, e.neighborhood AS ev_hood,
           ROW_NUMBER() OVER (PARTITION BY em.user_id ORDER BY e.start_time ASC) rn
    FROM public.event_members em JOIN public.events e ON e.id=em.event_id
    WHERE em.user_id IN (SELECT oid FROM enriched) AND em.status='joined'
      AND e.status IN ('forming','active','full')
      AND e.start_time>=now() AND e.start_time<now()+interval '7 days'
      AND public.is_plan_visible_to(em.user_id,p_user_id)
  )
  SELECT en.oid,pr.first_name_display,pr.profile_photo_url,pr.handle,
    public.yours_ring_bucket(en.last_ts) AS ring_bucket,
    en.cnt AS shared_count, public.yours_milestone(en.cnt) AS milestone,
    up.ev_id,up.ev_title,up.ev_start,en.connected_at,
    up.ev_hood
  FROM enriched en JOIN public.profiles pr ON pr.id=en.oid
  LEFT JOIN upcoming up ON up.oid=en.oid AND up.rn=1
  ORDER BY (up.ev_id IS NULL), up.ev_start ASC NULLS LAST,
           en.last_ts DESC NULLS LAST, en.connected_at DESC;
END; $function$;
REVOKE ALL ON FUNCTION public.get_yours_grid(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_yours_grid(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_yours_grid(uuid) TO authenticated, service_role;
