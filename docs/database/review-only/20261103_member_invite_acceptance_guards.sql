-- REVIEW ONLY. Not a deployed migration. No age/audience backfill or policy change.
-- Reject archived-community invitations and false success after a concurrent ban.
-- Built from the November 3 catalog snapshot. Refuse to replace a drifted routine.
BEGIN;
DO $check$
BEGIN
 IF md5(pg_get_functiondef('public.accept_member_invite(text,uuid)'::regprocedure))
   NOT IN ('6cb89d74e00358b966e9a6e7cb50f40b','900fdec93c21b0677654e8bacd036e5c') THEN
  RAISE EXCEPTION 'accept_member_invite changed; inspect current definition before applying this candidate';
 END IF;
END;
$check$;
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
  v_membership_writes integer;
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

  -- Serialize acceptance with archive; preserve existing draft invitations.
  PERFORM 1 FROM public.communities c
  WHERE c.id = v_invite.community_id AND c.status <> 'archived'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Community unavailable' USING ERRCODE = '42501';
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

  -- A concurrent ban may win after the initial check and skip the upsert.
  -- Never consume the invitation or claim success without a membership write.
  GET DIAGNOSTICS v_membership_writes = ROW_COUNT;
  IF v_membership_writes <> 1 THEN
    RAISE EXCEPTION 'cannot accept: banned from this community' USING ERRCODE = '42501';
  END IF;


  UPDATE public.community_member_invites
  SET status = 'accepted', accepted_at = now(), accepted_by_user_id = v_uid
  WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.community_id;
END;
$function$
;
COMMIT;
