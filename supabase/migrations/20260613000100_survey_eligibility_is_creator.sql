-- Migration 1 (2026-06-13): get_pending_post_plan_survey()
--   1. Suppress private circle plans (circle plan with ZERO strangers joined is
--      never the pending candidate; the query falls through to the next eligible
--      PUBLIC plan, so there is no pending pile-up / multi-pending risk).
--   2. Capture the plan creator (v_creator_user_id from events.creator_user_id).
--   3. Tag each member with is_creator; surface creator_user_id on the plan object.
-- is_stranger and keep_state are unchanged from the live prod definition.

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
  v_creator_user_id uuid;
  v_any_stranger boolean;
  v_members jsonb;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  SELECT e.id, e.title, e.image_url, e.circle_id, e.is_featured, e.creator_user_id
  INTO v_plan_id, v_title, v_image_url, v_circle_id, v_is_featured, v_creator_user_id
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
    -- Private circle plans (a circle plan with ZERO strangers joined) never
    -- trigger a survey; the candidate skips to the next eligible public plan.
    AND NOT (
      e.circle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM event_members em3
        WHERE em3.event_id = e.id AND em3.status = 'joined'
          AND NOT public.is_circle_member(e.circle_id, em3.user_id)
      )
    )
  ORDER BY e.start_time DESC
  LIMIT 1;

  IF v_plan_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', pp.id,
    'first_name_display', pp.first_name_display,
    'profile_photo_url', pp.profile_photo_url,
    'is_stranger', CASE
      WHEN v_circle_id IS NULL THEN false
      ELSE NOT public.is_circle_member(v_circle_id, pp.id)
    END,
    'is_creator', (pp.id = v_creator_user_id),
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
      'any_stranger_joined', v_any_stranger,
      'creator_user_id', v_creator_user_id
    ),
    'members', v_members
  );
END;
$function$;
