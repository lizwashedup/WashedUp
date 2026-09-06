-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
-- Delta fix over 20260901020000_build35_screen56_member_invites.sql (already-committed migration
-- history is immutable in this repo -- see scripts/release/migration-policy.mjs -- so this ships as
-- its own new migration instead of editing that file's bytes).
--
-- Bug found only by actually running the original migration live 2026-09-05: RETURNS TABLE(community_id
-- uuid) on accept_member_invite created an implicit PL/pgSQL variable that collided with the real
-- community_members.community_id column referenced bare inside an ON CONFLICT clause, throwing
-- 42702: column reference "community_id" is ambiguous. Same root cause on create_member_invite and
-- preview_member_invite's own RETURNS TABLE columns. Fix: #variable_conflict use_column as the first
-- line of each function body, the standard documented Postgres fix for this exact class of collision.
--
-- Already applied directly to production 2026-09-05 (Josh ran the corrected function bodies via the
-- Supabase SQL editor before this file existed). This migration exists so a fresh database build from
-- migration history reproduces the same, already-live, correct state -- re-declaring the exact live
-- function bodies below (pulled via pg_get_functiondef, byte-for-byte, not retyped).
BEGIN;

CREATE OR REPLACE FUNCTION public.create_member_invite(p_community_id uuid, p_target_user_id uuid, p_message text DEFAULT NULL::text)
 RETURNS TABLE(invite_id uuid, raw_token text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid     uuid := auth.uid();
  v_message text := btrim(p_message);
  v_token   text;
  v_id      uuid;
  v_expires timestamptz := now() + interval '72 hours';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_message = '' THEN v_message := NULL; END IF;
  IF v_message IS NOT NULL AND char_length(v_message) > 300 THEN
    RAISE EXCEPTION 'message is too long' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'a target profile is required' USING ERRCODE = '22023';
  END IF;
  IF p_target_user_id = v_uid THEN
    RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_community_leader(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'community leader or co-leader required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = p_community_id AND c.status <> 'archived') THEN
    RAISE EXCEPTION 'community not found or archived' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_target_user_id) THEN
    RAISE EXCEPTION 'that profile does not exist' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = p_community_id AND cm.user_id = p_target_user_id AND cm.status = 'banned'
  ) THEN
    RAISE EXCEPTION 'cannot invite: banned from this community' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = p_community_id AND cm.user_id = p_target_user_id
      AND cm.status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'already a member or has a pending join request' USING ERRCODE = '22023';
  END IF;

  UPDATE public.community_member_invites
  SET status = 'revoked', revoked_at = now(), revoked_by_user_id = v_uid
  WHERE community_id = p_community_id
    AND target_user_id = p_target_user_id
    AND status IN ('pending', 'viewed');

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.community_member_invites
    (community_id, invited_by_user_id, target_user_id, invite_message, token_hash, expires_at)
  VALUES
    (p_community_id, v_uid, p_target_user_id, v_message, md5(v_token), v_expires)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_expires;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_member_invite(p_token text)
 RETURNS TABLE(invite_id uuid, community_id uuid, community_name text, community_handle text, invited_by_name text, status community_member_invite_status, expires_at timestamp with time zone, invite_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_invite record;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN;
  END IF;

  SELECT i.*, c.name AS c_name, c.handle AS c_handle,
         coalesce(p.first_name_display, 'Someone') AS inviter_name
  INTO v_invite
  FROM public.community_member_invites i
  JOIN public.communities c ON c.id = i.community_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by_user_id
  WHERE i.token_hash = md5(p_token);

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_invite.status = 'pending' AND v_invite.expires_at > now() THEN
    UPDATE public.community_member_invites SET status = 'viewed' WHERE id = v_invite.id;
    v_invite.status := 'viewed';
  END IF;

  RETURN QUERY SELECT
    v_invite.id,
    v_invite.community_id,
    v_invite.c_name,
    v_invite.c_handle,
    v_invite.inviter_name,
    CASE WHEN v_invite.status IN ('pending', 'viewed') AND v_invite.expires_at <= now() THEN 'expired'::public.community_member_invite_status
         ELSE v_invite.status END,
    v_invite.expires_at,
    v_invite.invite_message;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_member_invite(p_token text DEFAULT NULL::text, p_invite_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(community_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid    uuid := auth.uid();
  v_invite public.community_member_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF (p_token IS NULL OR btrim(p_token) = '') AND p_invite_id IS NULL THEN
    RAISE EXCEPTION 'a token or invite id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invite
  FROM public.community_member_invites
  WHERE (p_token IS NOT NULL AND token_hash = md5(p_token))
     OR (p_invite_id IS NOT NULL AND id = p_invite_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found' USING ERRCODE = '22023';
  END IF;

  IF v_invite.status IN ('pending', 'viewed') AND v_invite.expires_at <= now() THEN
    UPDATE public.community_member_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'this invite has expired' USING ERRCODE = '22023';
  END IF;
  IF v_invite.status NOT IN ('pending', 'viewed') THEN
    RAISE EXCEPTION 'this invite is no longer available' USING ERRCODE = '22023';
  END IF;

  IF v_invite.target_user_id <> v_uid THEN
    RAISE EXCEPTION 'this invite is not for you' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = v_invite.community_id AND cm.user_id = v_uid AND cm.status = 'banned'
  ) THEN
    RAISE EXCEPTION 'cannot accept: banned from this community' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
  VALUES (v_invite.community_id, v_uid, 'member', 'active', now())
  ON CONFLICT (community_id, user_id) DO UPDATE
    SET status = 'active',
        joined_at = coalesce(public.community_members.joined_at, now())
    WHERE public.community_members.status <> 'banned';

  UPDATE public.community_member_invites
  SET status = 'accepted', accepted_at = now(), accepted_by_user_id = v_uid
  WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.community_id;
END;
$function$;

COMMIT;
