-- Yours page rebuild — 2/6: shared-plan + visibility + block helpers.
--
-- REVIEW ONLY. Not applied by the agent. See 1/6 header for prod-reconcile
-- notes. Verified against prod 2026-05-16:
--   * event_status enum: forming,active,full,completed,cancelled,draft
--     (completed = the sentinel used here, matching get_people_with_plan_history)
--   * member_status enum: joined,left,removed (joined = attended)
--   * block model: user_blocks(blocker_id,blocked_id) + legacy
--     profiles.blocked_users uuid[] (both checked, matching legacy RPCs)
--   * events have start_time + end_time; recency uses COALESCE(end_time,start_time)
--
-- Idempotent (CREATE OR REPLACE). All SECURITY DEFINER with a pinned
-- search_path. Self-test asserts signatures + security flags.

BEGIN;

-- True if either user has blocked the other, via the user_blocks table OR
-- the legacy profiles.blocked_users array (both honored, like the existing
-- get_people_with_plan_history / search_users_by_handle RPCs).
CREATE OR REPLACE FUNCTION public.yours_is_blocked_between(p_a uuid, p_b uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks ub
    WHERE (ub.blocker_id = p_a AND ub.blocked_id = p_b)
       OR (ub.blocker_id = p_b AND ub.blocked_id = p_a)
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE (pr.id = p_a AND p_b = ANY(COALESCE(pr.blocked_users, ARRAY[]::uuid[])))
       OR (pr.id = p_b AND p_a = ANY(COALESCE(pr.blocked_users, ARRAY[]::uuid[])))
  );
$$;

-- True if an accepted connection exists in either direction.
CREATE OR REPLACE FUNCTION public.yours_is_connected(p_a uuid, p_b uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.people_connections pc
    WHERE pc.status = 'accepted'
      AND ((pc.requester_user_id = p_a AND pc.recipient_user_id = p_b)
        OR (pc.requester_user_id = p_b AND pc.recipient_user_id = p_a))
  );
$$;

-- Count of distinct completed events both users joined.
CREATE OR REPLACE FUNCTION public.yours_shared_completed_count(p_a uuid, p_b uuid)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT COUNT(DISTINCT e.id)::int
  FROM public.event_members em_a
  JOIN public.event_members em_b ON em_b.event_id = em_a.event_id
  JOIN public.events e ON e.id = em_a.event_id
  WHERE em_a.user_id = p_a AND em_a.status = 'joined'
    AND em_b.user_id = p_b AND em_b.status = 'joined'
    AND e.status = 'completed';
$$;

-- Most recent shared completed plan time (recency drives the activity ring).
-- COALESCE(end_time, start_time) so a plan counts from when it actually
-- happened, in UTC timestamptz arithmetic (no local-day truncation).
CREATE OR REPLACE FUNCTION public.yours_last_shared_completed(p_a uuid, p_b uuid)
  RETURNS timestamptz
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT MAX(COALESCE(e.end_time, e.start_time))
  FROM public.event_members em_a
  JOIN public.event_members em_b ON em_b.event_id = em_a.event_id
  JOIN public.events e ON e.id = em_a.event_id
  WHERE em_a.user_id = p_a AND em_a.status = 'joined'
    AND em_b.user_id = p_b AND em_b.status = 'joined'
    AND e.status = 'completed';
$$;

-- Ring bucket from recency. UTC interval math; null/never => 'none'.
-- full <14d, 75 <30d, 50 <60d, 25 <120d, else none.
CREATE OR REPLACE FUNCTION public.yours_ring_bucket(p_ts timestamptz)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_ts IS NULL THEN 'none'
    WHEN now() - p_ts < interval '14 days'  THEN 'full'
    WHEN now() - p_ts < interval '30 days'  THEN '75'
    WHEN now() - p_ts < interval '60 days'  THEN '50'
    WHEN now() - p_ts < interval '120 days' THEN '25'
    ELSE 'none'
  END;
$$;

-- Milestone label by shared-plan count. Computed live (no stored counter,
-- no drift). 0 => NULL (render nothing).
CREATE OR REPLACE FUNCTION public.yours_milestone(p_count integer)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_count >= 25 THEN 'Ride or die'
    WHEN p_count >= 10 THEN 'Down for anything'
    WHEN p_count >= 5  THEN 'Regular thing'
    WHEN p_count >= 3  THEN 'Getting somewhere'
    WHEN p_count >= 1  THEN 'New crew'
    ELSE NULL
  END;
$$;

-- Is p_owner's upcoming-plan visibility on for p_viewer?
-- Global kill switch AND no per-person hide override. Centralizes the
-- precedence rule for every read RPC.
CREATE OR REPLACE FUNCTION public.is_plan_visible_to(p_owner uuid, p_viewer uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT pr.plans_visible_to_people FROM public.profiles pr WHERE pr.id = p_owner),
    true
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.people_plan_visibility ppv
    WHERE ppv.owner_user_id = p_owner
      AND ppv.viewer_user_id = p_viewer
      AND ppv.hidden = true
  );
$$;

REVOKE EXECUTE ON FUNCTION
  public.yours_is_blocked_between(uuid,uuid),
  public.yours_is_connected(uuid,uuid),
  public.yours_shared_completed_count(uuid,uuid),
  public.yours_last_shared_completed(uuid,uuid),
  public.yours_ring_bucket(timestamptz),
  public.yours_milestone(integer),
  public.is_plan_visible_to(uuid,uuid)
  FROM anon, public;
GRANT EXECUTE ON FUNCTION
  public.yours_is_blocked_between(uuid,uuid),
  public.yours_is_connected(uuid,uuid),
  public.yours_shared_completed_count(uuid,uuid),
  public.yours_last_shared_completed(uuid,uuid),
  public.yours_ring_bucket(timestamptz),
  public.yours_milestone(integer),
  public.is_plan_visible_to(uuid,uuid)
  TO authenticated;

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname IN ('yours_is_blocked_between','yours_is_connected',
      'yours_shared_completed_count','yours_last_shared_completed',
      'yours_ring_bucket','yours_milestone','is_plan_visible_to');
  IF n < 7 THEN
    RAISE EXCEPTION 'self-test: expected 7 yours helpers, found %', n;
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'is_plan_visible_to'
          AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'self-test: is_plan_visible_to is not SECURITY DEFINER';
  END IF;

  IF public.yours_ring_bucket(NULL) <> 'none'
     OR public.yours_ring_bucket(now()) <> 'full'
     OR public.yours_ring_bucket(now() - interval '90 days') <> '25'
     OR public.yours_milestone(0) IS NOT NULL
     OR public.yours_milestone(25) <> 'Ride or die'
     OR public.yours_milestone(1) <> 'New crew' THEN
    RAISE EXCEPTION 'self-test: ring/milestone logic incorrect';
  END IF;
END $$;

COMMIT;
