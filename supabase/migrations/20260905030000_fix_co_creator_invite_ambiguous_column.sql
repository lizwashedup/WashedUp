-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
-- Delta fix over 20260905010000_fix_co_creator_invite_role_default_draft.sql (already-committed
-- migration history is immutable in this repo -- see scripts/release/migration-policy.mjs -- so this
-- ships as its own new migration instead of editing that file's bytes).
--
-- Bug found only by actually running that migration live 2026-09-05: RETURNS TABLE(community_id uuid)
-- / RETURNS TABLE(community_id uuid, role public.community_member_role) on create_co_creator_invite,
-- preview_co_creator_invite, and accept_co_creator_invite created an implicit PL/pgSQL variable that
-- collided with real community_members columns referenced bare inside an ON CONFLICT clause, throwing
-- 42702: column reference "community_id" is ambiguous. Fix: #variable_conflict use_column as the first
-- line of each function body, the standard documented Postgres fix for this exact class of collision.
--
-- Already applied directly to production 2026-09-05 (Josh ran the corrected function bodies via the
-- Supabase SQL editor before this file existed). This migration exists so a fresh database build from
-- migration history reproduces the same, already-live, correct state -- re-declaring the exact live
-- function bodies below (pulled via pg_get_functiondef, byte-for-byte, not retyped).
BEGIN;

CREATE OR REPLACE FUNCTION public.create_co_creator_invite(p_community_id uuid, p_target_user_id uuid DEFAULT NULL::uuid, p_target_email text DEFAULT NULL::text, p_target_phone text DEFAULT NULL::text, p_role public.community_member_role DEFAULT 'co_leader'::public.community_member_role)
 RETURNS TABLE(invite_id uuid, raw_token text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text := CASE WHEN p_target_email IS NOT NULL THEN lower(btrim(p_target_email)) END;
  v_phone   text := CASE WHEN p_target_phone IS NOT NULL THEN regexp_replace(p_target_phone, '[^0-9]', '', 'g') END;
  v_token   text;
  v_id      uuid;
  v_expires timestamptz := now() + interval '72 hours';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_email = '' THEN v_email := NULL; END IF;
  IF v_phone = '' THEN v_phone := NULL; END IF;

  IF p_target_user_id IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'a target profile, email, or phone is required' USING ERRCODE = '22023';
  END IF;
  IF p_target_user_id IS NOT NULL AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
    RAISE EXCEPTION 'invite either an existing profile or a contact, not both' USING ERRCODE = '22023';
  END IF;
  IF p_target_user_id = v_uid THEN
    RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
  END IF;
  IF p_role IN ('leader', 'member') THEN
    RAISE EXCEPTION 'invite a role other than leader or plain member' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = p_community_id AND cm.user_id = v_uid
      AND cm.status = 'active' AND cm.role = 'leader'
  ) AND NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'primary leader required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = p_community_id AND c.status <> 'archived') THEN
    RAISE EXCEPTION 'community not found or archived' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_target_user_id) THEN
      RAISE EXCEPTION 'that profile does not exist' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id = p_community_id AND cm.user_id = p_target_user_id
        AND cm.status = 'active' AND cm.role IN ('leader', 'co_leader')
    ) THEN
      RAISE EXCEPTION 'already a leader or co-creator of this community' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.community_creator_invites
  SET status = 'revoked', revoked_at = now(), revoked_by_user_id = v_uid
  WHERE community_id = p_community_id
    AND status IN ('pending', 'viewed')
    AND (
      (p_target_user_id IS NOT NULL AND target_user_id = p_target_user_id)
      OR (v_email IS NOT NULL AND target_email = v_email)
      OR (v_phone IS NOT NULL AND target_phone = v_phone)
    );

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.community_creator_invites
    (community_id, invited_by_user_id, target_user_id, target_email, target_phone,
     role, token_hash, expires_at)
  VALUES
    (p_community_id, v_uid, p_target_user_id, v_email, v_phone, p_role, md5(v_token), v_expires)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_expires;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_co_creator_invite(p_token text)
 RETURNS TABLE(invite_id uuid, community_id uuid, community_name text, community_handle text, invited_by_name text, status community_creator_invite_status, expires_at timestamp with time zone, target_hint text, role community_member_role)
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
         coalesce(p.first_name_display, 'A community leader') AS inviter_name
  INTO v_invite
  FROM public.community_creator_invites i
  JOIN public.communities c ON c.id = i.community_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by_user_id
  WHERE i.token_hash = md5(p_token);

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_invite.status = 'pending' AND v_invite.expires_at > now() THEN
    UPDATE public.community_creator_invites SET status = 'viewed' WHERE id = v_invite.id;
    v_invite.status := 'viewed';
  END IF;

  RETURN QUERY SELECT
    v_invite.id,
    v_invite.community_id,
    v_invite.c_name,
    v_invite.c_handle,
    v_invite.inviter_name,
    CASE WHEN v_invite.status IN ('pending', 'viewed') AND v_invite.expires_at <= now() THEN 'expired'::public.community_creator_invite_status
         ELSE v_invite.status END,
    v_invite.expires_at,
    CASE
      WHEN v_invite.target_email IS NOT NULL THEN
        left(v_invite.target_email, 1) || '***@' || split_part(v_invite.target_email, '@', 2)
      WHEN v_invite.target_phone IS NOT NULL THEN
        '***' || right(v_invite.target_phone, 4)
      ELSE NULL
    END,
    v_invite.role;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_co_creator_invite(p_token text DEFAULT NULL::text, p_invite_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(community_id uuid, role community_member_role)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid          uuid := auth.uid();
  v_invite       public.community_creator_invites%ROWTYPE;
  v_email_match  boolean := false;
  v_phone_match  boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF (p_token IS NULL OR btrim(p_token) = '') AND p_invite_id IS NULL THEN
    RAISE EXCEPTION 'a token or invite id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invite
  FROM public.community_creator_invites
  WHERE (p_token IS NOT NULL AND token_hash = md5(p_token))
     OR (p_invite_id IS NOT NULL AND id = p_invite_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found' USING ERRCODE = '22023';
  END IF;

  IF v_invite.status IN ('pending', 'viewed') AND v_invite.expires_at <= now() THEN
    UPDATE public.community_creator_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'this invite has expired' USING ERRCODE = '22023';
  END IF;
  IF v_invite.status NOT IN ('pending', 'viewed') THEN
    RAISE EXCEPTION 'this invite is no longer available' USING ERRCODE = '22023';
  END IF;

  IF v_invite.target_user_id IS NOT NULL THEN
    IF v_invite.target_user_id <> v_uid THEN
      RAISE EXCEPTION 'this invite is not for you' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT
      (v_invite.target_email IS NOT NULL AND u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL
         AND lower(u.email) = v_invite.target_email),
      (v_invite.target_phone IS NOT NULL AND u.phone IS NOT NULL AND u.phone_confirmed_at IS NOT NULL
         AND regexp_replace(u.phone, '[^0-9]', '', 'g') = v_invite.target_phone)
    INTO v_email_match, v_phone_match
    FROM auth.users u
    WHERE u.id = v_uid;

    IF NOT (coalesce(v_email_match, false) OR coalesce(v_phone_match, false)) THEN
      RAISE EXCEPTION 'this invite is not for you' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = v_invite.community_id AND cm.user_id = v_uid AND cm.status = 'banned'
  ) THEN
    RAISE EXCEPTION 'cannot accept: banned from this community' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
  VALUES (v_invite.community_id, v_uid, v_invite.role, 'active', now())
  ON CONFLICT (community_id, user_id) DO UPDATE
    SET role = v_invite.role, status = 'active',
        joined_at = coalesce(public.community_members.joined_at, now())
    WHERE public.community_members.status <> 'banned';

  UPDATE public.community_creator_invites
  SET status = 'accepted', accepted_at = now(), accepted_by_user_id = v_uid,
      target_user_id = coalesce(target_user_id, v_uid)
  WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.community_id, v_invite.role;
END;
$function$;

COMMIT;
