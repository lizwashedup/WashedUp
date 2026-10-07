-- Local/review only. Preserve the exact public discovery policy, shape and ACL.
-- Remove only the final result ceiling; native readers page by stable ID.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.get_discoverable_communities()'::regprocedure)) NOT IN ('f017acf9f41f8f230647bd91eed21030','0b37eb568d2c4b63fb36e4481aa00916') THEN
  RAISE EXCEPTION 'Discovery definition changed; reconcile its visibility policy before applying';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.get_discoverable_communities()
 RETURNS TABLE(id uuid, handle text, name text, description text, accent_color text, cover_image text, member_count integer, next_event_title text, next_event_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    c.id, c.handle, c.name, c.description, c.accent_color,
    (SELECT b.content->'images'->>0
     FROM community_blocks b
     WHERE b.community_id = c.id AND b.block_type = 'cover' AND b.visible
     ORDER BY b.position LIMIT 1) AS cover_image,
    (SELECT count(*)::integer FROM community_members m
     WHERE m.community_id = c.id AND m.status = 'active') AS member_count,
    ne.title AS next_event_title,
    ne.event_date AS next_event_date
  FROM communities c
  LEFT JOIN LATERAL (
    SELECT e.title, e.event_date
    FROM explore_events e
    WHERE e.community_id = c.id AND e.status = 'Live'
      AND coalesce(e.event_date, current_date) >= current_date
    ORDER BY e.event_date ASC NULLS LAST
    LIMIT 1
  ) ne ON true
  WHERE c.status = 'active' AND public.creator_community_is_visible(c.id)
    AND c.discoverable
  ORDER BY member_count DESC, c.created_at ASC
;
$function$;

COMMIT;
