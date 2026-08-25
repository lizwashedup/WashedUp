-- Forward-only hardening for the authenticated plan-detail member list.
-- The earlier same-day migration introduced this RPC but did not gate the
-- requested event itself. Keep the intended authenticated plan-detail use,
-- while failing closed for hidden Circle plans and blocked relationships.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.yours_is_blocked_between(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'event member visibility dependencies are missing';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_members_event_joined_order_idx
  ON public.event_members (event_id, joined_at, user_id)
  WHERE status = 'joined';

DROP FUNCTION IF EXISTS public.get_event_members_public(uuid);

CREATE FUNCTION public.get_event_members_public(p_event_id uuid)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  role text,
  status text,
  joined_at timestamptz,
  first_name_display text,
  profile_photo_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_viewer uuid := auth.uid();
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Normal Plans and open Circle Plans are visible to authenticated viewers.
  -- Circle-only Plans require current Circle membership. The creator block
  -- check prevents this RPC from becoming an alternate route into a blocked
  -- creator's Plan.
  IF NOT EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = p_event_id
      AND e.status <> 'draft'
      AND (
        e.circle_id IS NULL
        OR e.circle_visibility = 'open'
        OR (
          e.circle_visibility = 'circle_only'
          AND EXISTS (
            SELECT 1
            FROM public.circle_members cm
            WHERE cm.circle_id = e.circle_id
              AND cm.user_id = v_viewer
              AND cm.status = 'joined'
          )
        )
      )
      AND NOT public.yours_is_blocked_between(v_viewer, e.creator_user_id)
  ) THEN
    RAISE EXCEPTION 'event not available' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    em.id,
    em.user_id,
    em.role::text,
    em.status::text,
    em.joined_at,
    p.first_name_display,
    p.profile_photo_url
  FROM public.event_members em
  JOIN public.profiles p ON p.id = em.user_id
  WHERE em.event_id = p_event_id
    AND em.status = 'joined'
    AND NOT public.yours_is_blocked_between(v_viewer, em.user_id)
  ORDER BY em.joined_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_members_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_members_public(uuid) TO authenticated;

-- Catalog-only verification. Behavioral role and visibility cases live in
-- the isolated private SQL contract and never inspect production rows.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_event_members_public(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_event_members_public must not be anon-callable';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_event_members_public(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_event_members_public must remain authenticated-callable';
  END IF;
  IF position('circle_members' IN pg_get_functiondef('public.get_event_members_public(uuid)'::regprocedure)) = 0
     OR position('yours_is_blocked_between' IN pg_get_functiondef('public.get_event_members_public(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'get_event_members_public lost a visibility or block guard';
  END IF;
END $$;

COMMIT;
