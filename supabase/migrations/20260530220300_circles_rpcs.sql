-- Circles (people + circles). 4/4: SECURITY DEFINER RPCs.
--
-- REVIEW ONLY. Not applied by the agent. See 1/4 header for prod-reconcile
-- notes. Verified 2026-05-30 against project upstjumasqblszevlgik.
--
-- All RPCs are SECURITY DEFINER with a pinned search_path. Because DEFINER
-- bypasses RLS, every RPC authorizes against auth.uid() itself:
--   * reads require is_circle_member; writes that change the circle or its
--     roster require is_circle_admin (the spec's admin model: admins invite,
--     promote, demote, set-all-to-admin; "everyone is an admin" is simply
--     every joined member holding the admin role).
-- Roster writes go through these RPCs, not table policies. No invite_permission
-- enum: invitation rights derive purely from circle_members.role.
--
-- circle_members.status reuses member_status {joined,left,removed}. There is no
-- 'invited' state in V1: invite_to_circle is a direct add (status 'joined'),
-- matching create_circle seeding. An accept/pending flow, if it lands later,
-- is additive.
--
-- Idempotent (CREATE OR REPLACE). Wrapped BEGIN/COMMIT with a self-test that
-- asserts every RPC exists and is SECURITY DEFINER.

BEGIN;

-- ---------------------------------------------------------------------------
-- create_circle: create a circle, seed caller as admin, add initial members.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_circle(
  p_name           text,
  p_description    text DEFAULT NULL,
  p_member_user_ids uuid[] DEFAULT '{}'
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_circle_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'circle name required';
  END IF;

  INSERT INTO public.circles (name, description, creator_user_id)
  VALUES (btrim(p_name), p_description, v_uid)
  RETURNING id INTO v_circle_id;

  -- creator is admin
  INSERT INTO public.circle_members (circle_id, user_id, role, status)
  VALUES (v_circle_id, v_uid, 'admin', 'joined');

  -- initial members (skip the creator, dedupe)
  INSERT INTO public.circle_members (circle_id, user_id, role, status)
  SELECT v_circle_id, m.uid, 'member', 'joined'
  FROM (SELECT DISTINCT unnest(COALESCE(p_member_user_ids, '{}')) AS uid) m
  WHERE m.uid IS NOT NULL AND m.uid <> v_uid
  ON CONFLICT (circle_id, user_id) DO NOTHING;

  RETURN v_circle_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- join_circle_atomic: caller joins (or re-joins) a circle. Mirrors
-- join_event_atomic, minus capacity (circles have no max).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_circle_atomic(p_circle_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- leave_circle: any member can leave. Plan history is untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_circle(p_circle_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.circle_members
  SET status = 'left'
  WHERE circle_id = p_circle_id AND user_id = v_uid AND status = 'joined';

  IF NOT FOUND THEN
    RETURN 'not_member';
  END IF;
  RETURN 'left';
END;
$$;

-- ---------------------------------------------------------------------------
-- get_circle: noticeboard payload. circle + joined members. pinned_plan and
-- recent_together are extension points for the noticeboard build (Step 4+);
-- returned as null / empty for now so the shape is stable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_circle(p_circle_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
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
    'pinned_plan', NULL,
    'recent_together', '[]'::jsonb
  )
  INTO v_out
  FROM public.circles c
  WHERE c.id = p_circle_id;

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_my_circles: directory rows for Yours > Circles (caller's joined circles).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_circles()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- invite_to_circle: admins add members directly (status 'joined'). Gated by
-- is_circle_admin per the role-based admin model.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_to_circle(
  p_circle_id uuid,
  p_user_ids  uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- update_circle: admin-only. Renames / cover / room toggle, plus the admin
-- designation model: promote, demote, or set-everyone-to-admin. The circle
-- creator is never demoted below admin (kept as the floor admin).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_circle(
  p_circle_id       uuid,
  p_name            text DEFAULT NULL,
  p_description     text DEFAULT NULL,
  p_cover_upload_id uuid DEFAULT NULL,
  p_room_enabled    boolean DEFAULT NULL,
  p_promote_user_ids uuid[] DEFAULT NULL,
  p_demote_user_ids  uuid[] DEFAULT NULL,
  p_set_all_admins   boolean DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
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
      cover_upload_id = COALESCE(p_cover_upload_id, cover_upload_id),
      room_enabled  = COALESCE(p_room_enabled, room_enabled),
      updated_at    = now()
  WHERE id = p_circle_id;

  -- set everyone to admin (the "anyone can invite" intentional-extension mode)
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
      -- creator stays the floor admin. v_creator is NULL once the creator has
      -- deleted their account; guard so demote still works on a creatorless
      -- circle (user_id <> NULL would otherwise match nothing).
      AND (v_creator IS NULL OR user_id <> v_creator);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_circle_chat_messages: paginated circle messages (newest first), keyset
-- on created_at. before_cursor is a timestamptz; pass the oldest created_at
-- you have to page back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_circle_chat_messages(
  p_circle_id    uuid,
  p_before_cursor timestamptz DEFAULT NULL,
  p_limit        integer DEFAULT 30
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
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
$$;

-- ---------------------------------------------------------------------------
-- Grants: callable by authenticated only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_circle(text, text, uuid[])           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_circle_atomic(uuid)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_circle(uuid)                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_circle(uuid)                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_circles()                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_to_circle(uuid, uuid[])              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_circle(uuid, text, text, uuid, boolean, uuid[], uuid[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_circle_chat_messages(uuid, timestamptz, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_circle(text, text, uuid[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_circle_atomic(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_circle(uuid)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_circle(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_circles()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_to_circle(uuid, uuid[])              TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_circle(uuid, text, text, uuid, boolean, uuid[], uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_circle_chat_messages(uuid, timestamptz, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test: every RPC exists and is SECURITY DEFINER.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'create_circle', 'join_circle_atomic', 'leave_circle', 'get_circle',
    'get_my_circles', 'invite_to_circle', 'update_circle', 'get_circle_chat_messages'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = v_fn AND prosecdef
    ) THEN
      RAISE EXCEPTION 'RPC % missing or not SECURITY DEFINER', v_fn;
    END IF;
  END LOOP;
END $$;

COMMIT;
