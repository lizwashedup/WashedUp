-- ===========================================================================
-- NOT YET APPLIED. Batch 3, file 9/9 (added 2026-06-11 for the survey v3 build).
-- Reviewed at the batch-3 checkpoint; applied to prod only on explicit go-ahead.
--
-- Post-plan survey v3 needs per-member facts the payload doesn't carry yet:
--   * is_stranger  — Step 2 "Who made it?" on an opened-up circle plan lists ONLY
--                    the strangers (joined members who are NOT circle members).
--   * keep_state   — Step 3 "Keep these people" filters by my relationship to each
--                    attendee. THIS IS SERVER-ONLY (it includes block state, which
--                    must never be inferred or fetched client-side). The client
--                    shows a chip only when keep_state IN ('incoming_pending','none')
--                    and never sees mutual / outgoing_pending / blocked people.
--
-- This is a single CREATE OR REPLACE of the LIVE get_pending_post_plan_survey body
-- (file 7, applied 2026-06-11) with EXACTLY the members projection enriched; the
-- selection query, the plan object, and every existing key are reproduced verbatim.
-- Reuses live helpers is_circle_member / yours_is_connected /
-- yours_is_blocked_between. Additive keys only.
--
-- Flag-off safety: gated survey path; purely additive member keys, existing
-- consumers ignore unknown keys. APPLY ORDER: must be live before v3 ships (Step 2
-- strangers + Step 3 filtering depend on it).
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_pending_post_plan_survey()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_title text;
  v_image_url text;
  v_circle_id uuid;
  v_is_featured boolean;
  v_any_stranger boolean;
  v_members jsonb;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT e.id, e.title, e.image_url, e.circle_id, e.is_featured
  INTO v_plan_id, v_title, v_image_url, v_circle_id, v_is_featured
  FROM events e
  JOIN event_members em ON em.event_id = e.id
                       AND em.user_id = v_user_id
                       AND em.status = 'joined'
  WHERE e.status = 'completed'
    AND date(e.start_time AT TIME ZONE 'America/Los_Angeles')
          < date((now()) AT TIME ZONE 'America/Los_Angeles')
    AND e.start_time >= (now() - interval '7 days')
    AND NOT EXISTS (
      SELECT 1 FROM plan_feedback pf
      WHERE pf.user_id = v_user_id AND pf.event_id = e.id
    )
  ORDER BY e.start_time DESC
  LIMIT 1;

  IF v_plan_id IS NULL THEN RETURN NULL; END IF;

  -- Enriched member facts. is_stranger drives Step 2's stranger-only list;
  -- keep_state drives Step 3 eligibility and is the ONLY source of block-awareness
  -- (never computed client-side).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pp.id,
    'first_name_display', pp.first_name_display,
    'profile_photo_url', pp.profile_photo_url,
    'is_stranger', CASE
      WHEN v_circle_id IS NULL THEN false
      ELSE NOT public.is_circle_member(v_circle_id, pp.id)
    END,
    'keep_state', CASE
      WHEN pp.id = v_user_id THEN 'none'
      WHEN public.yours_is_blocked_between(v_user_id, pp.id) THEN 'blocked'
      WHEN public.yours_is_connected(v_user_id, pp.id)      THEN 'mutual'
      WHEN EXISTS (
        SELECT 1 FROM public.people_connections pc
        WHERE pc.requester_user_id = pp.id
          AND pc.recipient_user_id = v_user_id
          AND pc.status = 'pending'
      ) THEN 'incoming_pending'
      WHEN EXISTS (
        SELECT 1 FROM public.people_connections pc
        WHERE pc.requester_user_id = v_user_id
          AND pc.recipient_user_id = pp.id
          AND pc.status = 'pending'
      ) THEN 'outgoing_pending'
      ELSE 'none'
    END
  )), '[]'::jsonb)
  INTO v_members
  FROM event_members em
  JOIN profiles_public pp ON pp.id = em.user_id
  WHERE em.event_id = v_plan_id AND em.status = 'joined';

  IF v_circle_id IS NULL THEN
    v_any_stranger := false;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM event_members em2
      WHERE em2.event_id = v_plan_id AND em2.status = 'joined'
        AND NOT public.is_circle_member(v_circle_id, em2.user_id)
    ) INTO v_any_stranger;
  END IF;

  RETURN jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_plan_id,
      'title', v_title,
      'image_url', v_image_url,
      'circle_id', v_circle_id,
      'is_featured', COALESCE(v_is_featured, false),
      'any_stranger_joined', v_any_stranger
    ),
    'members', v_members
  );
END;
$function$;

-- --- in-transaction self-test (rolls back; leaves no trace) ------------------
DO $$
DECLARE
  v_me       uuid := 'cafe0001-0000-0000-0000-000000000001';   -- Sage (caller + circle member)
  v_stranger uuid := 'cafe0002-0000-0000-0000-000000000002';   -- Marlowe (joined, NOT in circle)
  v_mutual   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';    -- Liz (joined, circle member, will be mutual)
  v_circle   uuid;
  v_event    uuid;
  v_out      jsonb;
  v_m_stranger jsonb;
  v_m_mutual   jsonb;
BEGIN
  BEGIN
    -- Isolate relationship rows for the pairs we assert on (rolled back).
    DELETE FROM public.people_connections
      WHERE (requester_user_id = v_me AND recipient_user_id IN (v_stranger, v_mutual))
         OR (recipient_user_id = v_me AND requester_user_id IN (v_stranger, v_mutual));

    INSERT INTO public.circles (name, creator_user_id, status)
    VALUES ('keepstate-selftest', v_me, 'active') RETURNING id INTO v_circle;
    INSERT INTO public.circle_members (circle_id, user_id, role, status) VALUES (v_circle, v_me, 'admin', 'joined');
    INSERT INTO public.circle_members (circle_id, user_id, role, status) VALUES (v_circle, v_mutual, 'member', 'joined');

    -- A completed circle plan yesterday PT; me + a circle-mate + a stranger all joined.
    INSERT INTO public.events (title, creator_user_id, circle_id, is_featured, start_time, end_time, status, gender_rule, min_invites, max_invites, member_count, city)
    VALUES ('keepstate-plan', v_me, v_circle, false, now() - interval '1 day', now() - interval '21 hours',
            'completed', 'mixed', 1, 8, 3, 'Los Angeles')
    RETURNING id INTO v_event;
    INSERT INTO public.event_members (event_id, user_id, role, status) VALUES (v_event, v_me, 'host', 'joined');
    INSERT INTO public.event_members (event_id, user_id, role, status) VALUES (v_event, v_mutual, 'guest', 'joined');
    INSERT INTO public.event_members (event_id, user_id, role, status) VALUES (v_event, v_stranger, 'guest', 'joined');

    -- Relationships: stranger has an INCOMING pending request to me; circle-mate is mutual.
    INSERT INTO public.people_connections (requester_user_id, recipient_user_id, status, context, can_re_request)
      VALUES (v_stranger, v_me, 'pending', 'plan_history', true);
    INSERT INTO public.people_connections (requester_user_id, recipient_user_id, status, context, can_re_request)
      VALUES (v_me, v_mutual, 'accepted', 'plan_history', true);

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
    v_out := public.get_pending_post_plan_survey();

    IF v_out->'plan'->>'id' IS DISTINCT FROM v_event::text THEN
      RAISE EXCEPTION 'self-test: wrong plan surfaced, got %', v_out->'plan'->>'id';
    END IF;

    SELECT m INTO v_m_stranger FROM jsonb_array_elements(v_out->'members') m WHERE m->>'id' = v_stranger::text;
    SELECT m INTO v_m_mutual   FROM jsonb_array_elements(v_out->'members') m WHERE m->>'id' = v_mutual::text;

    IF (v_m_stranger->>'is_stranger')::boolean <> true THEN
      RAISE EXCEPTION 'self-test: stranger should be is_stranger=true';
    END IF;
    IF v_m_stranger->>'keep_state' <> 'incoming_pending' THEN
      RAISE EXCEPTION 'self-test: stranger keep_state should be incoming_pending, got %', v_m_stranger->>'keep_state';
    END IF;
    IF (v_m_mutual->>'is_stranger')::boolean <> false THEN
      RAISE EXCEPTION 'self-test: circle-mate should be is_stranger=false';
    END IF;
    IF v_m_mutual->>'keep_state' <> 'mutual' THEN
      RAISE EXCEPTION 'self-test: circle-mate keep_state should be mutual, got %', v_m_mutual->>'keep_state';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'survey keep_state + is_stranger self-test passed';
END $$;

COMMIT;
