-- LOCAL REVIEW CANDIDATE. No production application authorized.
-- V-TEAM-03 reproduced: preview marks viewed; old cancellation silently did nothing.
-- Preserve signatures, grants, authorization, membership and terminal outcomes.
BEGIN;
CREATE OR REPLACE FUNCTION public.revoke_co_creator_invite(p_invite_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_invite public.community_creator_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite FROM public.community_creator_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_invite.invited_by_user_id <> v_uid
     AND NOT public.is_community_leader(v_invite.community_id, v_uid)
     AND NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorized to revoke this invite' USING ERRCODE = '42501';
  END IF;

  IF v_invite.status IN ('pending', 'viewed') THEN
    UPDATE public.community_creator_invites
    SET status = 'revoked', revoked_at = now(), revoked_by_user_id = v_uid
    WHERE id = p_invite_id;
  END IF;
END;
$function$;

COMMIT;
