-- Yours page rebuild — 3/6: read RPCs (grid, backlog, search, requests, card).
--
-- REVIEW ONLY. Not applied by the agent. See 1/6 + 2/6 headers.
-- BEFORE APPLYING, reconcile via Supabase MCP (verified 2026-05-16):
--   * Legacy get_people_with_plan_history(p_user_id) is friends-scoped and
--     left untouched so the legacy people-tab keeps working until the flag
--     flips. These RPCs are fresh and people_connections-scoped.
--   * search_users_by_handle is exact-handle-only; search_people below is
--     ALSO exact-@handle-only (no name search / no fuzzy / at most one row) —
--     WashedUp never surfaces strangers. Kept as a separate fresh RPC, not a
--     wrapper.
--   * Albums: plan_albums(id,event_id,status,archived_at) +
--     album_uploads(plan_album_id,user_id,thumbnail_url,display_url,
--     media_url,deleted_at,created_at). Adventures = shared completed
--     events whose plan_album has >=1 non-deleted upload.
--   * "live/upcoming" event_status = forming|active|full (not
--     completed|cancelled|draft).
--
-- All SECURITY DEFINER, pinned search_path, guarded so a caller can only
-- read their own graph (auth.uid() = p_user_id). Idempotent.

BEGIN;

-- ---------------------------------------------------------------------------
-- get_yours_grid: accepted connections with ring, milestone, upcoming pill.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_yours_grid(p_user_id uuid)
  RETURNS TABLE (
    user_id            uuid,
    first_name_display text,
    profile_photo_url  text,
    handle             text,
    ring_bucket        text,
    shared_count       integer,
    milestone          text,
    upcoming_event_id  uuid,
    upcoming_title     text,
    upcoming_start     timestamptz,
    connected_at       timestamptz
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  WITH others AS (
    SELECT CASE WHEN pc.requester_user_id = p_user_id
                THEN pc.recipient_user_id ELSE pc.requester_user_id END AS oid,
           pc.created_at AS connected_at
    FROM public.people_connections pc
    WHERE pc.status = 'accepted'
      AND p_user_id IN (pc.requester_user_id, pc.recipient_user_id)
  ),
  enriched AS (
    SELECT
      o.oid,
      o.connected_at,
      public.yours_shared_completed_count(p_user_id, o.oid) AS cnt,
      public.yours_last_shared_completed(p_user_id, o.oid)  AS last_ts
    FROM others o
    WHERE NOT public.yours_is_blocked_between(p_user_id, o.oid)
  ),
  upcoming AS (
    SELECT e.id AS oid_event, em.user_id AS oid, e.id AS ev_id,
           e.title AS ev_title, e.start_time AS ev_start,
           ROW_NUMBER() OVER (PARTITION BY em.user_id ORDER BY e.start_time ASC) rn
    FROM public.event_members em
    JOIN public.events e ON e.id = em.event_id
    WHERE em.user_id IN (SELECT oid FROM enriched)
      AND em.status = 'joined'
      AND e.status IN ('forming','active','full')
      AND e.start_time >= now()
      AND e.start_time < now() + interval '7 days'
      AND public.is_plan_visible_to(em.user_id, p_user_id)
  )
  SELECT
    en.oid,
    pr.first_name_display,
    pr.profile_photo_url,
    pr.handle,
    public.yours_ring_bucket(en.last_ts) AS ring_bucket,
    en.cnt AS shared_count,
    public.yours_milestone(en.cnt) AS milestone,
    up.ev_id,
    up.ev_title,
    up.ev_start,
    en.connected_at
  FROM enriched en
  JOIN public.profiles pr ON pr.id = en.oid
  LEFT JOIN upcoming up ON up.oid = en.oid AND up.rn = 1
  ORDER BY
    (up.ev_id IS NULL),          -- has a visible upcoming plan first
    up.ev_start ASC NULLS LAST,
    en.last_ts DESC NULLS LAST,  -- then most recent shared plan
    en.connected_at DESC;        -- then most recently added
END;
$$;

-- ---------------------------------------------------------------------------
-- get_plan_history_backlog: people you've completed a plan with, not yet
-- connected. Visibility: people who declined YOU are hidden everywhere;
-- people YOU declined/removed are hidden here (findable via search);
-- pending = 'requested'; blocked = hidden.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_plan_history_backlog(p_user_id uuid)
  RETURNS TABLE (
    user_id            uuid,
    first_name_display text,
    profile_photo_url  text,
    handle             text,
    shared_count       integer,
    state              text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT DISTINCT em_o.user_id AS oid
    FROM public.event_members em_me
    JOIN public.event_members em_o ON em_o.event_id = em_me.event_id
    JOIN public.events e ON e.id = em_me.event_id
    WHERE em_me.user_id = p_user_id AND em_me.status = 'joined'
      AND em_o.status = 'joined' AND em_o.user_id <> p_user_id
      AND e.status = 'completed'
  ),
  filtered AS (
    SELECT c.oid,
           public.yours_shared_completed_count(p_user_id, c.oid) AS cnt,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.people_connections pc
             WHERE pc.requester_user_id = p_user_id
               AND pc.recipient_user_id = c.oid
               AND pc.status = 'pending'
           ) THEN 'requested' ELSE 'none' END AS st
    FROM candidates c
    WHERE NOT public.yours_is_connected(p_user_id, c.oid)
      AND NOT public.yours_is_blocked_between(p_user_id, c.oid)
      -- they declined me => hidden everywhere
      AND NOT EXISTS (
        SELECT 1 FROM public.people_connections pc
        WHERE pc.requester_user_id = p_user_id
          AND pc.recipient_user_id = c.oid
          AND pc.status = 'declined'
      )
      -- I declined/removed them => hidden from backlog (findable in search)
      AND NOT EXISTS (
        SELECT 1 FROM public.people_connections pc
        WHERE ((pc.requester_user_id = c.oid AND pc.recipient_user_id = p_user_id)
            OR (pc.requester_user_id = p_user_id AND pc.recipient_user_id = c.oid))
          AND pc.status IN ('declined','removed')
          AND NOT (pc.requester_user_id = p_user_id AND pc.status = 'declined')
      )
  )
  SELECT f.oid, pr.first_name_display, pr.profile_photo_url, pr.handle,
         f.cnt, f.st
  FROM filtered f
  JOIN public.profiles pr ON pr.id = f.oid
  WHERE pr.onboarding_status = 'complete'
  ORDER BY f.cnt DESC, pr.first_name_display ASC;
END;
$$;

-- ---------------------------------------------------------------------------
-- search_people: fuzzy name/handle across all complete profiles. People who
-- declined YOU stay hidden; people YOU declined/removed ARE findable here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_people(p_user_id uuid, p_query text)
  RETURNS TABLE (
    user_id            uuid,
    first_name_display text,
    profile_photo_url  text,
    handle             text,
    shared_count       integer,
    connection_state   text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  -- Exact @handle lookup ONLY. WashedUp never surfaces strangers: no name
  -- search, no fuzzy/ILIKE, no directory, at most one row. You can only find
  -- someone whose exact handle you already know. Function name + signature
  -- kept stable (CLAUDE.md); p_query carries the typed handle.
  v_handle text := lower(ltrim(trim(p_query), '@'));
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF length(v_handle) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    pr.first_name_display,
    pr.profile_photo_url,
    pr.handle,
    public.yours_shared_completed_count(p_user_id, pr.id) AS cnt,
    CASE
      WHEN public.yours_is_connected(p_user_id, pr.id) THEN 'connected'
      WHEN EXISTS (SELECT 1 FROM public.people_connections pc
                   WHERE pc.requester_user_id = p_user_id
                     AND pc.recipient_user_id = pr.id
                     AND pc.status = 'pending') THEN 'requested'
      WHEN EXISTS (SELECT 1 FROM public.people_connections pc
                   WHERE pc.requester_user_id = pr.id
                     AND pc.recipient_user_id = p_user_id
                     AND pc.status = 'pending') THEN 'incoming'
      ELSE 'none'
    END AS connection_state
  FROM public.profiles pr
  WHERE pr.id <> p_user_id
    AND pr.onboarding_status = 'complete'
    AND lower(pr.handle) = v_handle
    AND NOT public.yours_is_blocked_between(p_user_id, pr.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.people_connections pc
      WHERE pc.requester_user_id = p_user_id
        AND pc.recipient_user_id = pr.id
        AND pc.status = 'declined'
    )
  LIMIT 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_incoming_people_requests: pending requests addressed to me.
-- context_line is dash-free; client may override with COPY constants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_incoming_people_requests(p_user_id uuid)
  RETURNS TABLE (
    connection_id      uuid,
    requester_user_id  uuid,
    first_name_display text,
    profile_photo_url  text,
    handle             text,
    context            text,
    context_event_id   uuid,
    context_event_title text,
    context_line       text,
    requested_at       timestamptz
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    pc.id,
    pc.requester_user_id,
    pr.first_name_display,
    pr.profile_photo_url,
    pr.handle,
    pc.context,
    pc.context_event_id,
    ev.title,
    CASE pc.context
      WHEN 'plan_history' THEN
        'You were both on ' || COALESCE(ev.title, 'a plan')
      WHEN 'referral_invite' THEN
        COALESCE(pr.first_name_display, 'They') || ' invited you to WashedUp'
      WHEN 'handle_lookup' THEN 'Found you on WashedUp'
      ELSE 'Found you on WashedUp'
    END AS context_line,
    pc.requested_at
  FROM public.people_connections pc
  JOIN public.profiles pr ON pr.id = pc.requester_user_id
  LEFT JOIN public.events ev ON ev.id = pc.context_event_id
  WHERE pc.recipient_user_id = p_user_id
    AND pc.status = 'pending'
    AND NOT public.yours_is_blocked_between(p_user_id, pc.requester_user_id)
  ORDER BY pc.requested_at DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_profile_card: full when connected, otherwise minimal. Returns one row;
-- upcoming/adventures/since_date are NULL in the minimal case.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profile_card(p_user_id uuid, p_target uuid)
  RETURNS TABLE (
    kind               text,
    user_id            uuid,
    first_name_display text,
    profile_photo_url  text,
    handle             text,
    shared_count       integer,
    milestone          text,
    since_date         timestamptz,
    upcoming           jsonb,
    adventures         jsonb
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_connected boolean;
  v_cnt integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF public.yours_is_blocked_between(p_user_id, p_target) THEN
    RETURN; -- no row: blocked is invisible
  END IF;

  v_connected := public.yours_is_connected(p_user_id, p_target);
  v_cnt := public.yours_shared_completed_count(p_user_id, p_target);

  IF NOT v_connected THEN
    RETURN QUERY
    SELECT 'minimal'::text, pr.id, pr.first_name_display, pr.profile_photo_url,
           pr.handle, v_cnt, public.yours_milestone(v_cnt),
           NULL::timestamptz, NULL::jsonb, NULL::jsonb
    FROM public.profiles pr WHERE pr.id = p_target;
    RETURN;
  END IF;

  RETURN QUERY
  WITH since AS (
    SELECT MIN(COALESCE(e.end_time, e.start_time)) AS d
    FROM public.event_members em_a
    JOIN public.event_members em_b ON em_b.event_id = em_a.event_id
    JOIN public.events e ON e.id = em_a.event_id
    WHERE em_a.user_id = p_user_id AND em_a.status = 'joined'
      AND em_b.user_id = p_target AND em_b.status = 'joined'
      AND e.status = 'completed'
  ),
  up AS (
    SELECT jsonb_agg(jsonb_build_object(
             'event_id', e.id, 'title', e.title, 'start_time', e.start_time)
           ORDER BY e.start_time ASC) AS j
    FROM public.event_members em
    JOIN public.events e ON e.id = em.event_id
    WHERE em.user_id = p_target AND em.status = 'joined'
      AND e.status IN ('forming','active','full')
      AND e.start_time >= now()
      AND public.is_plan_visible_to(p_target, p_user_id)
  ),
  adv AS (
    SELECT jsonb_agg(x.obj ORDER BY x.ev_start DESC) AS j FROM (
      SELECT DISTINCT ON (pa.id)
        jsonb_build_object(
          'album_id', pa.id, 'event_id', e.id, 'title', e.title,
          'date', COALESCE(e.end_time, e.start_time),
          'thumb_url', COALESCE(au.thumbnail_url, au.display_url, au.media_url)
        ) AS obj,
        COALESCE(e.end_time, e.start_time) AS ev_start
      FROM public.event_members em_a
      JOIN public.event_members em_b ON em_b.event_id = em_a.event_id
      JOIN public.events e ON e.id = em_a.event_id
      JOIN public.plan_albums pa ON pa.event_id = e.id AND pa.archived_at IS NULL
      JOIN public.album_uploads au ON au.plan_album_id = pa.id
        AND au.deleted_at IS NULL
      WHERE em_a.user_id = p_user_id AND em_a.status = 'joined'
        AND em_b.user_id = p_target AND em_b.status = 'joined'
        AND e.status = 'completed'
      ORDER BY pa.id, au.created_at ASC
    ) x
  )
  SELECT 'full'::text, pr.id, pr.first_name_display, pr.profile_photo_url,
         pr.handle, v_cnt, public.yours_milestone(v_cnt),
         (SELECT d FROM since),
         COALESCE((SELECT j FROM up), '[]'::jsonb),
         COALESCE((SELECT j FROM adv), '[]'::jsonb)
  FROM public.profiles pr WHERE pr.id = p_target;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.get_yours_grid(uuid),
  public.get_plan_history_backlog(uuid),
  public.search_people(uuid,text),
  public.get_incoming_people_requests(uuid),
  public.get_profile_card(uuid,uuid)
  FROM anon, public;
GRANT EXECUTE ON FUNCTION
  public.get_yours_grid(uuid),
  public.get_plan_history_backlog(uuid),
  public.search_people(uuid,text),
  public.get_incoming_people_requests(uuid),
  public.get_profile_card(uuid,uuid)
  TO authenticated;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname='public' AND p.proname IN
    ('get_yours_grid','get_plan_history_backlog','search_people',
     'get_incoming_people_requests','get_profile_card')
    AND p.prosecdef;
  IF n < 5 THEN
    RAISE EXCEPTION 'self-test: expected 5 SECURITY DEFINER read RPCs, found %', n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema='public' AND grantee='anon'
      AND routine_name IN ('get_yours_grid','get_plan_history_backlog',
        'search_people','get_incoming_people_requests','get_profile_card')
  ) THEN
    RAISE EXCEPTION 'self-test: a read RPC is exposed to anon';
  END IF;
END $$;

COMMIT;
