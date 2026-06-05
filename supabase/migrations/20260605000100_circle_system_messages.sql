-- Circles (Step 9a): system join/leave messages in the circle chat.
--
-- REVIEW ONLY. NOT applied by the agent. Sits on top of 20260530220300
-- (the circle RPCs). Safe to apply independently of the push work (9b).
--
-- The 220200 polymorphic-chat migration anticipated this: "System join/leave
-- messages are written by SECURITY DEFINER RPCs, which bypass RLS." So rather
-- than a circle_members trigger (which would have to special-case the bulk
-- member insert at create time), we CREATE OR REPLACE the three roster RPCs to
-- post a system line. create_circle stays SILENT on purpose (no "joined" spam
-- for the founding members). These bodies are faithful copies of 220300 plus
-- the system-message post; keep them in sync if 220300 ever changes.
--
-- A circle system message is a normal messages row: message_type='system',
-- circle_id set, event_id NULL (satisfies messages_parent_xor), user_id = the
-- subject (who joined/left). CircleMessageBubble renders content verbatim, so
-- content is self-contained ("Liz joined" / "Liz left"). The new-message push
-- trigger already skips message_type='system', so these never push.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: post a system line into a circle chat. SECURITY DEFINER so it can
-- INSERT past the "user_id = auth.uid()" send policy (the subject may differ
-- from the actor, e.g. an admin inviting someone).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_circle_system_message(
  p_circle_id uuid,
  p_user_id   uuid,
  p_content   text
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  INSERT INTO public.messages (circle_id, user_id, content, message_type)
  VALUES (p_circle_id, p_user_id, p_content, 'system');
$$;

CREATE OR REPLACE FUNCTION public.circle_display_name(p_user_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(btrim(first_name_display), ''), handle, 'Someone')
  FROM public.profiles WHERE id = p_user_id;
$$;

-- ---------------------------------------------------------------------------
-- join_circle_atomic: post "<name> joined" only on a real transition into the
-- circle (fresh row, or re-join from left/removed). A no-op re-join stays quiet.
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
  v_prior  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_circle FROM public.circles WHERE id = p_circle_id FOR UPDATE;
  IF v_circle IS NULL THEN
    RETURN 'not_found';
  END IF;

  SELECT status INTO v_prior
  FROM public.circle_members WHERE circle_id = p_circle_id AND user_id = v_uid;

  UPDATE public.circle_members
  SET status = 'joined'
  WHERE circle_id = p_circle_id AND user_id = v_uid;

  IF NOT FOUND THEN
    INSERT INTO public.circle_members (circle_id, user_id, role, status)
    VALUES (p_circle_id, v_uid, 'member', 'joined');
  END IF;

  IF v_prior IS DISTINCT FROM 'joined' THEN
    PERFORM public.post_circle_system_message(
      p_circle_id, v_uid, public.circle_display_name(v_uid) || ' joined');
  END IF;

  RETURN 'joined';
END;
$$;

-- ---------------------------------------------------------------------------
-- leave_circle: post "<name> left" only when a joined member actually leaves.
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

  PERFORM public.post_circle_system_message(
    p_circle_id, v_uid, public.circle_display_name(v_uid) || ' left');

  RETURN 'left';
END;
$$;

-- ---------------------------------------------------------------------------
-- invite_to_circle: post "<name> joined" for each member who actually
-- transitions into the circle (a fresh add or a re-add from left/removed).
-- Mirrors 220300 plus capturing the affected user_ids for the system lines.
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
  v_uid     uuid := auth.uid();
  v_added   uuid[];
  v_subject uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_circle_admin(p_circle_id, v_uid) THEN
    RAISE EXCEPTION 'only an admin can invite to this circle';
  END IF;

  -- Capture the user_ids that actually inserted or transitioned into the
  -- circle (the ON CONFLICT WHERE suppresses RETURNING for already-joined
  -- members, so no-op re-adds are excluded from both the count and the lines).
  WITH ins AS (
    INSERT INTO public.circle_members (circle_id, user_id, role, status)
    SELECT p_circle_id, u.uid, 'member', 'joined'
    FROM (SELECT DISTINCT unnest(COALESCE(p_user_ids, '{}')) AS uid) u
    WHERE u.uid IS NOT NULL
    ON CONFLICT (circle_id, user_id)
      DO UPDATE SET status = 'joined'
      WHERE public.circle_members.status <> 'joined'
    RETURNING user_id
  )
  SELECT array_agg(user_id) INTO v_added FROM ins;

  FOREACH v_subject IN ARRAY COALESCE(v_added, '{}'::uuid[]) LOOP
    PERFORM public.post_circle_system_message(
      p_circle_id, v_subject, public.circle_display_name(v_subject) || ' joined');
  END LOOP;

  RETURN COALESCE(array_length(v_added, 1), 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants (match 220300; helpers are internal-only).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.post_circle_system_message(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.circle_display_name(uuid)                    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.circle_display_name(uuid)                  TO authenticated;
-- join/leave/invite grants are unchanged from 220300 (CREATE OR REPLACE keeps them).

-- ---------------------------------------------------------------------------
-- Self-test: helpers exist + are SECURITY DEFINER, and the three RPCs still do.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'post_circle_system_message', 'circle_display_name',
    'join_circle_atomic', 'leave_circle', 'invite_to_circle'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = v_fn AND prosecdef) THEN
      RAISE EXCEPTION 'function % missing or not SECURITY DEFINER', v_fn;
    END IF;
  END LOOP;
END $$;

COMMIT;
