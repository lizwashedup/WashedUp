-- ===========================================================================
-- NOT YET APPLIED. Batch 3, file 4/8. Reviewed at the batch-3 checkpoint;
-- applied to prod only on explicit go-ahead, in the batch order.
--
-- Circle-identity deferrals (audit + circle-identity-design-spec): populate the
-- two get_circle fields the circle page already reserves but that prod returns as
-- stubs (pinned_plan = NULL, recent_together = '[]').
--
-- This is a single CREATE OR REPLACE of the live get_circle body with EXACTLY two
-- stubs replaced; everything else is reproduced verbatim.
--
--   pinned_plan: the circle's next upcoming plan
--     events where circle_id = this circle, status IN (forming/active/full),
--     COALESCE(end_time, start_time + 3h) > now(), earliest start. Carries
--     circle_size + circle_in_count computed with the SAME subqueries the batch-2
--     feed uses (single-source capacity rule) -> the card's "{filled} of {size} in".
--
--   recent_together: newest plan-album PHOTOS from this circle's plans (cap 9,
--     newest first). album-media is a PRIVATE bucket: the client signs
--     COALESCE(display_url, media_url) itself (as app/album/[eventId].tsx does),
--     and storage RLS gates signing on album_visibility. So we return ONLY paths
--     the CALLER can sign -- the uploader's own rows OR rows with a visibility
--     grant to the caller -- guaranteeing no broken images, ever. Living cover =
--     recent_together[0].media_path (client uses it as the auto fallback when
--     circle.cover_upload_id is null; precedence manual > living > monogram).
--
-- Flag-off safety: gated (GROUPS_ENABLED off). Additive jsonb keys only; the
-- membership gate and shape are unchanged for every existing key.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_circle(p_circle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_circle_member(p_circle_id, v_uid) THEN
    RAISE EXCEPTION 'not a member of this circle';
  END IF;

  SELECT jsonb_build_object(
    'circle', to_jsonb(c),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', cm.user_id,
        'role', cm.role,
        'joined_at', cm.joined_at,
        'first_name_display', p.first_name_display,
        'last_name', p.last_name,
        'handle', p.handle,
        'profile_photo_url', p.profile_photo_url
      ) ORDER BY cm.joined_at)
      FROM public.circle_members cm
      JOIN public.profiles p ON p.id = cm.user_id
      WHERE cm.circle_id = p_circle_id AND cm.status = 'joined'
    ), '[]'::jsonb),
    -- NEW: the circle's next upcoming plan + its capacity counts.
    'pinned_plan', (
      SELECT jsonb_build_object(
        'id', ev.id,
        'title', ev.title,
        'start_time', ev.start_time,
        'image_url', ev.image_url,
        'circle_size', (
          SELECT count(*)::int FROM public.circle_members cm2
          WHERE cm2.circle_id = c.id AND cm2.status = 'joined'
        ),
        'circle_in_count', (
          SELECT count(*)::int FROM public.event_members em2
          WHERE em2.event_id = ev.id AND em2.status = 'joined'
            AND public.is_circle_member(c.id, em2.user_id)
        )
      )
      FROM public.events ev
      WHERE ev.circle_id = c.id
        AND ev.status IN ('forming','active','full')
        AND COALESCE(ev.end_time, ev.start_time + INTERVAL '3 hours') > now()
      ORDER BY ev.start_time ASC
      LIMIT 1
    ),
    -- NEW: newest plan-album photos from this circle, gated to caller-signable
    -- paths. [0] doubles as the living-cover source.
    'recent_together', COALESCE((
      SELECT jsonb_agg(x.obj ORDER BY x.created_at DESC)
      FROM (
        SELECT jsonb_build_object(
          'upload_id', u.id,
          'media_path', COALESCE(u.display_url, u.media_url),
          'content_type', u.content_type,
          'created_at', u.created_at,
          'user_id', u.user_id,
          'first_name_display', pu.first_name_display,
          'profile_photo_url', pu.profile_photo_url
        ) AS obj, u.created_at
        FROM public.album_uploads u
        JOIN public.plan_albums pa ON pa.id = u.plan_album_id
        JOIN public.events ev2 ON ev2.id = pa.event_id AND ev2.circle_id = c.id
        JOIN public.profiles pu ON pu.id = u.user_id
        WHERE u.deleted_at IS NULL
          AND u.content_type = 'photo'
          AND (
            u.user_id = v_uid
            OR EXISTS (
              SELECT 1 FROM public.album_visibility av
              WHERE av.upload_id = u.id
                AND av.visible_to_user_id = v_uid
                AND NOT av.hidden_by_viewer
            )
          )
        ORDER BY u.created_at DESC
        LIMIT 9
      ) x
    ), '[]'::jsonb)
  )
  INTO v_out
  FROM public.circles c
  WHERE c.id = p_circle_id;

  RETURN v_out;
END;
$function$;

-- --- in-transaction self-test (rolls back; leaves no trace) ------------------
DO $$
DECLARE
  v_uid    uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';   -- Liz (caller + member)
  v_circle uuid;
  v_event  uuid;
  v_album  uuid;
  v_upload uuid;
  v_out    jsonb;
BEGIN
  BEGIN
    INSERT INTO public.circles (name, creator_user_id, status)
    VALUES ('detail-data-selftest', v_uid, 'active') RETURNING id INTO v_circle;
    INSERT INTO public.circle_members (circle_id, user_id, role, status)
    VALUES (v_circle, v_uid, 'admin', 'joined');

    -- An upcoming circle plan the caller is in -> pinned_plan + capacity 1 of 1.
    INSERT INTO public.events (title, creator_user_id, circle_id, start_time, end_time, status, gender_rule, min_invites, max_invites, member_count, city)
    VALUES ('pinned-selftest', v_uid, v_circle, now() + interval '1 day', now() + interval '1 day 3 hours',
            'forming', 'mixed', 1, 8, 1, 'Los Angeles')
    RETURNING id INTO v_event;
    INSERT INTO public.event_members (event_id, user_id, role, status)
    VALUES (v_event, v_uid, 'host', 'joined');

    -- A plan album + the caller's own photo -> recent_together (self-signable).
    INSERT INTO public.plan_albums (event_id, status) VALUES (v_event, 'ready') RETURNING id INTO v_album;
    INSERT INTO public.album_uploads (plan_album_id, user_id, media_url, content_type, media_format, file_size_bytes, heart_count, marketing_consent, notification_pending)
    VALUES (v_album, v_uid, v_circle || '/' || v_uid || '/x/p.jpg', 'photo', 'jpg', 1024, 0, false, false)
    RETURNING id INTO v_upload;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    v_out := public.get_circle(v_circle);

    IF v_out->'pinned_plan'->>'id' IS DISTINCT FROM v_event::text THEN
      RAISE EXCEPTION 'self-test: pinned_plan id mismatch, got %', v_out->'pinned_plan'->>'id';
    END IF;
    IF (v_out->'pinned_plan'->>'circle_size')::int <> 1
       OR (v_out->'pinned_plan'->>'circle_in_count')::int <> 1 THEN
      RAISE EXCEPTION 'self-test: capacity wrong, size=% in=%',
        v_out->'pinned_plan'->>'circle_size', v_out->'pinned_plan'->>'circle_in_count';
    END IF;
    IF jsonb_array_length(v_out->'recent_together') <> 1 THEN
      RAISE EXCEPTION 'self-test: recent_together should have 1 photo, got %',
        jsonb_array_length(v_out->'recent_together');
    END IF;
    IF v_out->'recent_together'->0->>'upload_id' IS DISTINCT FROM v_upload::text THEN
      RAISE EXCEPTION 'self-test: recent_together upload mismatch';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'get_circle detail-data self-test passed';
END $$;

COMMIT;
