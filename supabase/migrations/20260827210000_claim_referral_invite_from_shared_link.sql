-- Claim a shared /r/<code> invite after authentication.
--
-- Product direction confirmed by Liz 2026-08-27: when a person follows an
-- invite before joining, the inviter's people request must be waiting for the
-- recipient after onboarding. The old client flow called send_people_request
-- as the recipient, which reversed that direction. Generic share sheets also
-- do not reveal the recipient's phone number, so record_referral_invite cannot
-- run before the link is opened.
--
-- This RPC resolves and records the invite atomically after phone auth. It is
-- authenticated-only, respects blocks and terminal declines/removals, creates
-- inviter -> recipient, and records referral conversion when a profile phone
-- is available. Repeated opens do not duplicate rows or notifications.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_referral_invite(p_code text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_recipient uuid := auth.uid();
  v_inviter uuid;
  v_phone text;
  v_phone_hash text;
BEGIN
  IF v_recipient IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_referral_code';
  END IF;

  SELECT pr.id
    INTO v_inviter
  FROM public.profiles pr
  WHERE pr.referral_code = p_code
  LIMIT 1;

  IF v_inviter IS NULL THEN
    RAISE EXCEPTION 'invalid_referral_code';
  END IF;
  IF v_inviter = v_recipient THEN
    RAISE EXCEPTION 'invalid_recipient';
  END IF;
  IF public.yours_is_blocked_between(v_inviter, v_recipient) THEN
    RAISE EXCEPTION 'blocked';
  END IF;

  -- An accepted relationship already satisfies the invite.
  IF public.yours_is_connected(v_inviter, v_recipient) THEN
    RETURN v_inviter;
  END IF;

  -- Never use possession of an old link to reopen a terminal rejection.
  IF EXISTS (
    SELECT 1
    FROM public.people_connections pc
    WHERE pc.requester_user_id = v_inviter
      AND pc.recipient_user_id = v_recipient
      AND pc.status IN ('declined', 'removed')
      AND pc.can_re_request = false
  ) THEN
    RAISE EXCEPTION 'cannot_re_request';
  END IF;

  INSERT INTO public.people_connections AS pc
    (requester_user_id, recipient_user_id, status, context,
     context_event_id, requested_at, responded_at)
  VALUES
    (v_inviter, v_recipient, 'pending', 'referral_invite',
     NULL, now(), NULL)
  ON CONFLICT (requester_user_id, recipient_user_id) DO UPDATE
    SET status = 'pending',
        context = 'referral_invite',
        context_event_id = NULL,
        requested_at = now(),
        responded_at = NULL
    WHERE pc.can_re_request = true
      AND pc.status <> 'accepted';

  -- The generic share sheet cannot tell the inviter which phone received the
  -- text. Once the recipient authenticates, the verified profile phone lets
  -- us create the conversion record without exposing the number to clients.
  SELECT pr.phone_number
    INTO v_phone
  FROM public.profiles pr
  WHERE pr.id = v_recipient;

  IF v_phone IS NOT NULL AND length(v_phone) > 0 THEN
    v_phone_hash := encode(extensions.digest(v_phone, 'sha256'), 'hex');
    INSERT INTO public.referral_invites AS ri
      (inviter_user_id, invited_phone_hash, invited_contact_name,
       referral_code, status, referred_user_id, invited_at, signed_up_at)
    VALUES
      (v_inviter, v_phone_hash, NULL, p_code, 'signed_up', v_recipient,
       now(), now())
    ON CONFLICT (inviter_user_id, invited_phone_hash) DO UPDATE
      SET referred_user_id = COALESCE(ri.referred_user_id, EXCLUDED.referred_user_id),
          status = CASE
            WHEN ri.status = 'pending' THEN 'signed_up'
            ELSE ri.status
          END,
          signed_up_at = COALESCE(ri.signed_up_at, EXCLUDED.signed_up_at);
  END IF;

  RETURN v_inviter;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_referral_invite(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_referral_invite(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_referral_invite(text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'claim_referral_invite'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'self-test: claim_referral_invite missing or not SECURITY DEFINER';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public'
      AND routine_name = 'claim_referral_invite'
      AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'self-test: claim_referral_invite exposed outside authenticated';
  END IF;
END $$;

COMMIT;
