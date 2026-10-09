-- EMERGENCY ROLLBACK ONLY. Restores the exact pre-release RPC definitions.
-- This removes new blocking protections; prefer retaining them when reverting
-- only the app. Never run to address an unrelated issue. Retains every data row
-- and the additive push diagnostic table/RPC. Aborts on newer routine changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $rollback_guard$
DECLARE actual text;
BEGIN

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='edit_own_chat_message' AND pg_get_function_identity_arguments(p.oid)='p_message_id uuid, p_kind text, p_conversation_id uuid, p_expected_content text, p_content text';
  IF actual IS DISTINCT FROM 'dd660acd4ee50da649dac601a73fef9d' THEN RAISE EXCEPTION 'Rollback refused: changed routine edit_own_chat_message'; END IF;

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='edit_own_chat_message_with_mentions' AND pg_get_function_identity_arguments(p.oid)='p_message_id uuid, p_kind text, p_conversation_id uuid, p_expected_content text, p_content text, p_expected_mentions jsonb, p_mentions jsonb';
  IF actual IS DISTINCT FROM 'ac2f72109b59e936e394659261b4a3b0' THEN RAISE EXCEPTION 'Rollback refused: changed routine edit_own_chat_message_with_mentions'; END IF;

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_circle' AND pg_get_function_identity_arguments(p.oid)='p_circle_id uuid';
  IF actual IS DISTINCT FROM 'c37fb988f2778e3417e4cf5eefbb7628' THEN RAISE EXCEPTION 'Rollback refused: changed routine get_circle'; END IF;

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_circle_chat_messages' AND pg_get_function_identity_arguments(p.oid)='p_circle_id uuid, p_before_cursor timestamp with time zone, p_limit integer';
  IF actual IS DISTINCT FROM '21ad1387b9a0d0a8bc8621556014e68f' THEN RAISE EXCEPTION 'Rollback refused: changed routine get_circle_chat_messages'; END IF;

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_my_circle_chat_cards' AND pg_get_function_identity_arguments(p.oid)='';
  IF actual IS DISTINCT FROM '1a93849dc6c6c4c2c7ee35e2786ddfee' THEN RAISE EXCEPTION 'Rollback refused: changed routine get_my_circle_chat_cards'; END IF;

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_my_circles' AND pg_get_function_identity_arguments(p.oid)='';
  IF actual IS DISTINCT FROM '5ea53656e9ef2b2d4c06b27fcb78604d' THEN RAISE EXCEPTION 'Rollback refused: changed routine get_my_circles'; END IF;

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='invite_to_circle' AND pg_get_function_identity_arguments(p.oid)='p_circle_id uuid, p_user_ids uuid[]';
  IF actual IS DISTINCT FROM 'b0ead656d293a55ff8a40019cb704776' THEN RAISE EXCEPTION 'Rollback refused: changed routine invite_to_circle'; END IF;

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='join_circle_atomic' AND pg_get_function_identity_arguments(p.oid)='p_circle_id uuid';
  IF actual IS DISTINCT FROM '69200592729c3202cc8ee04d5c9f7b9a' THEN RAISE EXCEPTION 'Rollback refused: changed routine join_circle_atomic'; END IF;

  SELECT md5(pg_get_functiondef(p.oid)) INTO actual FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='update_circle' AND pg_get_function_identity_arguments(p.oid)='p_circle_id uuid, p_name text, p_description text, p_cover_upload_id uuid, p_room_enabled boolean, p_promote_user_ids uuid[], p_demote_user_ids uuid[], p_set_all_admins boolean, p_clear_cover boolean';
  IF actual IS DISTINCT FROM 'abb63dc38c2a310ea7c29ceb705a7382' THEN RAISE EXCEPTION 'Rollback refused: changed routine update_circle'; END IF;

END;
$rollback_guard$;

CREATE OR REPLACE FUNCTION public.edit_own_chat_message(p_message_id uuid, p_kind text, p_conversation_id uuid, p_expected_content text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.messages%ROWTYPE;
  v_event public.events%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  -- Preserve the production account hold for the newly introduced UPDATE path.
  -- A shared profile lock serializes the permission check with moderation changes.
  PERFORM 1 FROM public.profiles WHERE id = v_uid
    AND (suspended_until IS NULL OR suspended_until <= statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF p_message_id IS NULL OR p_conversation_id IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('event','circle') OR p_expected_content IS NULL
     OR p_content IS NULL OR length(btrim(p_content)) = 0 OR length(p_content) > 1000 THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  IF p_kind = 'event' THEN
    SELECT * INTO v_event FROM public.events WHERE id = p_conversation_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    PERFORM 1 FROM public.event_members WHERE event_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    -- Same end-first 48-hour writing window as the native Plan chat.
    -- This does not install or change the separately held archive job.
    IF v_event.status::text = 'cancelled' OR statement_timestamp() >=
      (CASE WHEN v_event.end_time > v_event.start_time THEN v_event.end_time ELSE v_event.start_time END) + interval '48 hours' THEN
      RETURN jsonb_build_object('status','closed');
    END IF;
  ELSE
    PERFORM 1 FROM public.circle_members WHERE circle_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END IF;
  SELECT * INTO v_message FROM public.messages
    WHERE id = p_message_id AND user_id = v_uid
      AND ((p_kind = 'event' AND event_id = p_conversation_id AND circle_id IS NULL)
        OR (p_kind = 'circle' AND circle_id = p_conversation_id AND event_id IS NULL))
    FOR UPDATE;
  IF NOT FOUND OR v_message.message_type::text IS DISTINCT FROM 'user'
      OR v_message.image_url IS NOT NULL OR v_message.audio_url IS NOT NULL THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  IF v_message.content = p_content THEN
    RETURN jsonb_build_object('status','saved','id',v_message.id,'content',v_message.content);
  END IF;
  IF v_message.content IS DISTINCT FROM p_expected_content THEN
    RETURN jsonb_build_object('status','changed');
  END IF;
  UPDATE public.messages SET content = p_content WHERE id = v_message.id;
  RETURN jsonb_build_object('status','saved','id',v_message.id,'content',p_content);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.edit_own_chat_message_with_mentions(p_message_id uuid, p_kind text, p_conversation_id uuid, p_expected_content text, p_content text, p_expected_mentions jsonb, p_mentions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.messages%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_mentions jsonb;
  v_expected_mentions jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  -- Preserve the production account hold for the newly introduced UPDATE path.
  -- A shared profile lock serializes the permission check with moderation changes.
  PERFORM 1 FROM public.profiles WHERE id = v_uid
    AND (suspended_until IS NULL OR suspended_until <= statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  IF p_message_id IS NULL OR p_conversation_id IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('event','circle') OR p_expected_content IS NULL
     OR p_content IS NULL OR length(btrim(p_content)) = 0 OR length(p_content) > 1000 THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  IF p_kind = 'event' THEN
    SELECT * INTO v_event FROM public.events WHERE id = p_conversation_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    PERFORM 1 FROM public.event_members WHERE event_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
    -- Same end-first 48-hour writing window as the native Plan chat.
    -- This does not install or change the separately held archive job.
    IF v_event.status::text = 'cancelled' OR statement_timestamp() >=
      (CASE WHEN v_event.end_time > v_event.start_time THEN v_event.end_time ELSE v_event.start_time END) + interval '48 hours' THEN
      RETURN jsonb_build_object('status','closed');
    END IF;
  ELSE
    PERFORM 1 FROM public.circle_members WHERE circle_id = p_conversation_id
      AND user_id = v_uid AND status = 'joined' FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END IF;
  SELECT * INTO v_message FROM public.messages
    WHERE id = p_message_id AND user_id = v_uid
      AND ((p_kind = 'event' AND event_id = p_conversation_id AND circle_id IS NULL)
        OR (p_kind = 'circle' AND circle_id = p_conversation_id AND event_id IS NULL))
    FOR UPDATE;
  IF NOT FOUND OR v_message.message_type::text IS DISTINCT FROM 'user'
      OR v_message.image_url IS NOT NULL OR v_message.audio_url IS NOT NULL THEN
    RETURN jsonb_build_object('status','unavailable');
  END IF;
  v_mentions := public.validate_chat_mention_document(p_content,p_mentions);
  v_expected_mentions := public.validate_chat_mention_document(p_expected_content,p_expected_mentions);
  IF v_message.content = p_content
    AND coalesce(v_message.mention_data->'references','[]'::jsonb) = coalesce(v_mentions->'references','[]'::jsonb) THEN
    RETURN jsonb_build_object('status','saved','id',v_message.id,'content',v_message.content,'mention_data',v_message.mention_data);
  END IF;
  IF v_message.content IS DISTINCT FROM p_expected_content
    OR coalesce(v_message.mention_data->'references','[]'::jsonb) IS DISTINCT FROM coalesce(v_expected_mentions->'references','[]'::jsonb) THEN
    RETURN jsonb_build_object('status','changed');
  END IF;
  UPDATE public.messages SET content = p_content, mention_data = v_mentions WHERE id = v_message.id;
  RETURN jsonb_build_object('status','saved','id',v_message.id,'content',p_content,'mention_data',v_mentions);
END;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.get_circle_chat_messages(p_circle_id uuid, p_before_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30)
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

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      m.id,
      m.circle_id,
      m.user_id,
      m.content,
      m.message_type,
      m.image_url,
      m.audio_url,
      m.duration_seconds,
      m.reply_to_message_id,
      m.created_at,
      p.first_name_display,
      p.last_name,
      p.handle,
      p.profile_photo_url
    FROM public.messages m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.circle_id = p_circle_id
      AND (p_before_cursor IS NULL OR m.created_at < p_before_cursor)
    ORDER BY m.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100))
  ) r;

  RETURN v_out;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_circle_chat_cards()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select jsonb_agg(card
             order by (card->>'last_message_at') desc nulls last,
                      (card->>'created_at') desc)
    from (
      select jsonb_build_object(
        'circle_id', c.id,
        'name', c.name,
        'status', c.status,
        'created_at', c.created_at,
        'member_count', coalesce(mc.n, 0),
        'members', coalesce(rs.members, '[]'::jsonb),
        'last_message', lm.msg,
        'last_message_at', lm.msg_at,
        'unread_count', coalesce(ur.n, 0)
      ) as card
      from circle_members mine
      join circles c on c.id = mine.circle_id
      left join lateral (
        select count(*)::int as n
        from circle_members cm
        where cm.circle_id = c.id and cm.status = 'joined'
      ) mc on true
      left join lateral (
        select jsonb_agg(jsonb_build_object(
                 'user_id', cm.user_id,
                 'first_name', p.first_name_display,
                 'avatar_url', p.profile_photo_url
               ) order by cm.joined_at) as members
        from circle_members cm
        left join profiles_public p on p.id = cm.user_id
        where cm.circle_id = c.id and cm.status = 'joined'
      ) rs on true
      left join lateral (
        select jsonb_build_object(
                 'content', m.content,
                 'created_at', m.created_at,
                 'message_type', m.message_type,
                 'image_url', m.image_url,
                 'audio_url', m.audio_url,
                 'user_id', m.user_id,
                 'sender_name', p.first_name_display
               ) as msg,
               m.created_at as msg_at
        from messages m
        left join profiles_public p on p.id = m.user_id
        where m.circle_id = c.id
        order by m.created_at desc
        limit 1
      ) lm on true
      left join lateral (
        select count(*)::int as n
        from messages m
        where m.circle_id = c.id
          and m.user_id is distinct from auth.uid()
          and m.created_at > coalesce(
            (select r.last_read_at from chat_reads r
             where r.circle_id = c.id and r.user_id = auth.uid()),
            '-infinity'::timestamptz)
      ) ur on true
      where mine.user_id = auth.uid() and mine.status = 'joined'
    ) cards
  ), '[]'::jsonb);
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_circles()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY (d.last_message_at IS NULL), d.last_message_at DESC, d.created_at DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      c.id,
      c.name,
      c.description,
      c.cover_upload_id,
      c.status,
      c.room_enabled,
      c.created_at,
      mine.role AS my_role,
      (SELECT count(*)::int FROM public.circle_members cm2
        WHERE cm2.circle_id = c.id AND cm2.status = 'joined') AS member_count,
      (SELECT max(m.created_at) FROM public.messages m
        WHERE m.circle_id = c.id) AS last_message_at
    FROM public.circle_members mine
    JOIN public.circles c ON c.id = mine.circle_id
    WHERE mine.user_id = v_uid AND mine.status = 'joined'
  ) d;

  RETURN v_out;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.invite_to_circle(p_circle_id uuid, p_user_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_circle_admin(p_circle_id, v_uid) THEN
    RAISE EXCEPTION 'only an admin can invite to this circle';
  END IF;

  WITH ins AS (
    INSERT INTO public.circle_members (circle_id, user_id, role, status)
    SELECT p_circle_id, u.uid, 'member', 'joined'
    FROM (SELECT DISTINCT unnest(COALESCE(p_user_ids, '{}')) AS uid) u
    WHERE u.uid IS NOT NULL
    ON CONFLICT (circle_id, user_id)
      DO UPDATE SET status = 'joined'
      WHERE public.circle_members.status <> 'joined'
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.join_circle_atomic(p_circle_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_circle RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_circle FROM public.circles WHERE id = p_circle_id FOR UPDATE;
  IF v_circle IS NULL THEN
    RETURN 'not_found';
  END IF;

  UPDATE public.circle_members
  SET status = 'joined'
  WHERE circle_id = p_circle_id AND user_id = v_uid;

  IF NOT FOUND THEN
    INSERT INTO public.circle_members (circle_id, user_id, role, status)
    VALUES (p_circle_id, v_uid, 'member', 'joined');
  END IF;

  RETURN 'joined';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_circle(p_circle_id uuid, p_name text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_cover_upload_id uuid DEFAULT NULL::uuid, p_room_enabled boolean DEFAULT NULL::boolean, p_promote_user_ids uuid[] DEFAULT NULL::uuid[], p_demote_user_ids uuid[] DEFAULT NULL::uuid[], p_set_all_admins boolean DEFAULT NULL::boolean, p_clear_cover boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_creator uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_circle_admin(p_circle_id, v_uid) THEN
    RAISE EXCEPTION 'only an admin can update this circle';
  END IF;

  SELECT creator_user_id INTO v_creator FROM public.circles WHERE id = p_circle_id;

  UPDATE public.circles
  SET name         = COALESCE(NULLIF(btrim(p_name), ''), name),
      description   = COALESCE(p_description, description),
      cover_upload_id = CASE
                          WHEN p_clear_cover THEN NULL
                          ELSE COALESCE(p_cover_upload_id, cover_upload_id)
                        END,
      room_enabled  = COALESCE(p_room_enabled, room_enabled),
      updated_at    = now()
  WHERE id = p_circle_id;

  IF p_set_all_admins IS TRUE THEN
    UPDATE public.circle_members
    SET role = 'admin'
    WHERE circle_id = p_circle_id AND status = 'joined';
  END IF;

  IF p_promote_user_ids IS NOT NULL THEN
    UPDATE public.circle_members
    SET role = 'admin'
    WHERE circle_id = p_circle_id
      AND status = 'joined'
      AND user_id = ANY(p_promote_user_ids);
  END IF;

  IF p_demote_user_ids IS NOT NULL THEN
    UPDATE public.circle_members
    SET role = 'member'
    WHERE circle_id = p_circle_id
      AND status = 'joined'
      AND user_id = ANY(p_demote_user_ids)
      AND (v_creator IS NULL OR user_id <> v_creator);
  END IF;
END;
$function$
;

DROP POLICY private_chat_block_select ON public.messages;

DROP POLICY private_chat_block_insert ON public.messages;

DROP POLICY private_chat_block_update ON public.messages;

DROP POLICY private_chat_reaction_select ON public.message_reactions;

DROP POLICY private_chat_reaction_insert ON public.message_reactions;

DROP POLICY private_chat_reaction_update ON public.message_reactions;

DROP FUNCTION public.private_chat_contact_allowed(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
