-- LOCAL / REVIEW ONLY. Separate accepted page delegation; no legacy backfill.
-- D13: owner invites an existing account for one approved published page.
-- No membership/follow/chat/attendance/approval/financial writes or notifications.
BEGIN;
CREATE TABLE public.creator_page_team_invitations (
 id uuid PRIMARY KEY,
 page_id uuid NOT NULL,
 inviter_id uuid NOT NULL,
 recipient_id uuid NOT NULL CHECK(recipient_id<>inviter_id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','canceled','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '72 hours'),
 resolved_at timestamptz,
 CHECK(expires_at>created_at),
 CHECK((status='pending' AND resolved_at IS NULL) OR (status<>'pending' AND resolved_at IS NOT NULL))
);
-- Deliberate durable identity columns: account/page disappearance hides access,
-- but does not cascade away invitation outcomes or rewrite historical assignments.
CREATE UNIQUE INDEX creator_page_team_one_pending ON public.creator_page_team_invitations(page_id,recipient_id) WHERE status='pending';
CREATE INDEX creator_page_team_recipient ON public.creator_page_team_invitations(recipient_id,created_at DESC);
CREATE TABLE public.creator_page_team_invite_attempts (
 request_id uuid PRIMARY KEY,
 page_id uuid NOT NULL,
 inviter_id uuid NOT NULL,
 recipient_id uuid NOT NULL,
 invitation_id uuid NOT NULL REFERENCES public.creator_page_team_invitations(id)
);
CREATE TABLE public.creator_page_team_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 page_id uuid NOT NULL,
 user_id uuid NOT NULL,
 invitation_id uuid NOT NULL UNIQUE REFERENCES public.creator_page_team_invitations(id),
 accepted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(page_id,user_id)
);
REVOKE ALL ON public.creator_page_team_invitations,public.creator_page_team_invite_attempts,public.creator_page_team_assignments FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.creator_page_team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_page_team_invite_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_page_team_assignments ENABLE ROW LEVEL SECURITY;

-- Private caller-independent predicate; never expose an identity lookup oracle.
CREATE FUNCTION public.creator_page_team_eligible(p_page_id uuid,p_owner_id uuid,p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_owner_id IS NOT NULL AND p_user_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.creator_page_publications p
  JOIN public.creator_page_drafts d ON d.id=p.page_id AND d.owner_id=p.owner_id AND d.page_kind=p.page_kind
  JOIN public.creator_page_submissions s ON s.id=p.submission_id AND s.page_id=p.page_id AND s.status='approved'
  WHERE p.page_id=p_page_id AND p.owner_id=p_owner_id
   AND EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles f ON f.id=u.id WHERE u.id=p_owner_id AND (u.banned_until IS NULL OR u.banned_until<=now()))
   AND EXISTS(SELECT 1 FROM auth.users u JOIN public.profiles f ON f.id=u.id WHERE u.id=p_user_id AND (u.banned_until IS NULL OR u.banned_until<=now()))
   AND NOT public.yours_is_blocked_between(p_owner_id,p_user_id)
   AND (p.page_kind='organization' OR (
    public.creator_page_audience_matches(p.audience,p_owner_id) AND public.creator_page_audience_matches(p.audience,p_user_id)
    AND EXISTS(SELECT 1 FROM public.communities c WHERE c.id=p.page_id AND c.created_by=p_owner_id AND c.status='active')
    AND EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=p.page_id AND m.user_id=p_owner_id AND m.role='leader' AND m.status='active')
    AND NOT EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=p.page_id AND m.user_id=p_user_id AND m.status='banned')
   ))
 );
$$;
REVOKE ALL ON FUNCTION public.creator_page_team_eligible(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.creator_page_team_receipt(p_invite public.creator_page_team_invitations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('invitation_id',p_invite.id,'page_id',p_invite.page_id,'page_kind',p.page_kind,'page_name',p.name,
  'inviter_id',p_invite.inviter_id,'recipient_id',p_invite.recipient_id,'role','co_creator',
  'status',CASE WHEN p_invite.status='pending' AND p_invite.expires_at<=now() THEN 'expired' ELSE p_invite.status END,
  'created_at',p_invite.created_at,'expires_at',p_invite.expires_at,'resolved_at',CASE WHEN p_invite.status='pending' AND p_invite.expires_at<=now() THEN p_invite.expires_at ELSE p_invite.resolved_at END,
  'assignment_id',(SELECT a.id FROM public.creator_page_team_assignments a WHERE a.invitation_id=p_invite.id))
 FROM public.creator_page_publications p WHERE p.page_id=p_invite.page_id;
$$;
REVOKE ALL ON FUNCTION public.creator_page_team_receipt(public.creator_page_team_invitations) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_creator_page_team_invitation(p_page_id uuid,p_invitation_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.creator_page_team_invitations; u uuid:=auth.uid();
BEGIN
 SELECT * INTO i FROM public.creator_page_team_invitations WHERE id=p_invitation_id AND page_id=p_page_id;
 IF u IS NULL OR i.id IS NULL OR u NOT IN(i.inviter_id,i.recipient_id)
 OR NOT public.creator_page_team_eligible(i.page_id,i.inviter_id,u)
 OR NOT public.creator_page_team_eligible(i.page_id,i.inviter_id,i.recipient_id) THEN
  RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 RETURN public.creator_page_team_receipt(i);
END;
$$;

CREATE FUNCTION public.create_creator_page_team_invitation(p_page_id uuid,p_request_id uuid,p_recipient_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); p public.creator_page_publications; i public.creator_page_team_invitations; a public.creator_page_team_invite_attempts;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_recipient_id IS NULL OR p_recipient_id=u THEN RAISE EXCEPTION 'Choose another existing account' USING ERRCODE='22023'; END IF;
 -- Serialize invitation/response operations per page, retaining existing event locks.
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id FOR UPDATE;
 IF p.page_id IS NULL OR p.owner_id<>u OR NOT public.creator_page_team_eligible(p_page_id,u,p_recipient_id) THEN
  RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_team_invite_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.inviter_id<>u OR a.recipient_id<>p_recipient_id THEN
   RAISE EXCEPTION 'Invitation attempt does not match' USING ERRCODE='22023'; END IF;
  RETURN public.get_creator_page_team_invitation(p_page_id,a.invitation_id);
 END IF;
 IF p.page_kind='community' AND EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=p_page_id AND m.user_id=p_recipient_id AND m.role IN('leader','co_leader') AND m.status='active') THEN
  RAISE EXCEPTION 'This person already has community team access' USING ERRCODE='PT409'; END IF;
 -- A new explicit attempt can refer to an existing pending/accepted record;
 -- its own mapping ensures a lost create response can resolve the same identity.
 SELECT inv.* INTO i FROM public.creator_page_team_invitations inv
 JOIN public.creator_page_team_assignments g ON g.invitation_id=inv.id
 WHERE g.page_id=p_page_id AND g.user_id=p_recipient_id AND inv.inviter_id=u;
 IF i.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.creator_page_team_assignments WHERE page_id=p_page_id AND user_id=p_recipient_id) THEN
   RAISE EXCEPTION 'Page team requires review' USING ERRCODE='PT409'; END IF;
  UPDATE public.creator_page_team_invitations SET status='expired',resolved_at=expires_at
   WHERE page_id=p_page_id AND recipient_id=p_recipient_id AND status='pending' AND expires_at<=now();
  SELECT * INTO i FROM public.creator_page_team_invitations WHERE page_id=p_page_id AND recipient_id=p_recipient_id AND status='pending';
  IF i.id IS NOT NULL AND i.inviter_id<>u THEN RAISE EXCEPTION 'Page team requires review' USING ERRCODE='PT409'; END IF;
  IF i.id IS NULL THEN
   INSERT INTO public.creator_page_team_invitations(id,page_id,inviter_id,recipient_id)
    VALUES(p_request_id,p_page_id,u,p_recipient_id) RETURNING * INTO i;
  END IF;
 END IF;
 INSERT INTO public.creator_page_team_invite_attempts(request_id,page_id,inviter_id,recipient_id,invitation_id)
  VALUES(p_request_id,p_page_id,u,p_recipient_id,i.id) ON CONFLICT(request_id) DO NOTHING;
 SELECT * INTO a FROM public.creator_page_team_invite_attempts WHERE request_id=p_request_id;
 IF a.page_id<>p_page_id OR a.inviter_id<>u OR a.recipient_id<>p_recipient_id OR a.invitation_id<>i.id THEN
  RAISE EXCEPTION 'Invitation attempt does not match' USING ERRCODE='22023'; END IF;
 RETURN public.get_creator_page_team_invitation(p_page_id,i.id);
END;
$$;

CREATE FUNCTION public.resolve_creator_page_team_invitation(p_page_id uuid,p_invitation_id uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); i public.creator_page_team_invitations; desired text;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN('accept','decline','cancel') THEN RAISE EXCEPTION 'Choose an invitation action' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.creator_page_publications WHERE page_id=p_page_id FOR UPDATE;
 SELECT * INTO i FROM public.creator_page_team_invitations WHERE id=p_invitation_id AND page_id=p_page_id FOR UPDATE;
 IF i.id IS NULL OR (p_action='cancel' AND u<>i.inviter_id) OR (p_action<>'cancel' AND u<>i.recipient_id)
 OR NOT public.creator_page_team_eligible(i.page_id,i.inviter_id,u)
 OR NOT public.creator_page_team_eligible(i.page_id,i.inviter_id,i.recipient_id) THEN
  RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 desired:=CASE p_action WHEN 'accept' THEN 'accepted' WHEN 'decline' THEN 'declined' ELSE 'canceled' END;
 IF i.status=desired THEN RETURN public.creator_page_team_receipt(i); END IF;
 IF i.status<>'pending' THEN RAISE EXCEPTION 'Invitation already resolved. Check its saved outcome.' USING ERRCODE='PT409'; END IF;
 IF i.expires_at<=now() THEN RETURN public.creator_page_team_receipt(i); END IF;
 IF desired='accepted' THEN
  INSERT INTO public.creator_page_team_assignments(page_id,user_id,invitation_id) VALUES(i.page_id,i.recipient_id,i.id);
 END IF;
 UPDATE public.creator_page_team_invitations SET status=desired,resolved_at=now() WHERE id=i.id RETURNING * INTO i;
 RETURN public.creator_page_team_receipt(i);
END;
$$;

CREATE FUNCTION public.get_creator_page_team_invitation_attempt(p_page_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_team_invite_attempts; p public.creator_page_publications;
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF auth.uid() IS NULL OR p.page_id IS NULL OR p.owner_id<>auth.uid() OR NOT public.creator_page_team_eligible(p_page_id,auth.uid(),auth.uid()) THEN
  RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_team_invite_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NULL THEN RETURN NULL; END IF;
 IF a.page_id<>p_page_id OR a.inviter_id<>auth.uid() THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 RETURN public.get_creator_page_team_invitation(p_page_id,a.invitation_id);
END;
$$;

CREATE FUNCTION public.list_my_creator_page_team_invitations() RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.creator_page_team_receipt(i) FROM public.creator_page_team_invitations i
 WHERE auth.uid() IS NOT NULL AND i.recipient_id=auth.uid()
 AND public.creator_page_team_eligible(i.page_id,i.inviter_id,auth.uid())
 ORDER BY i.created_at DESC,i.id;
$$;

-- A narrow capability contract, initially unconnected to legacy helpers.
-- Never route ticketing, Stripe, refunds, platform permissions or chat membership
-- through this predicate. Consumer wiring is a separate verified increment.
CREATE FUNCTION public.creator_page_team_can_manage(p_page_id uuid,p_capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(p_capability IN('page_content','page_events','membership_requests'),false) AND EXISTS(
  SELECT 1 FROM public.creator_page_publications p WHERE p.page_id=p_page_id
   AND (p_capability<>'membership_requests' OR p.page_kind='community')
   AND public.creator_page_team_eligible(p.page_id,p.owner_id,auth.uid())
   AND (p.owner_id=auth.uid() OR EXISTS(SELECT 1 FROM public.creator_page_team_assignments a
     JOIN public.creator_page_team_invitations i ON i.id=a.invitation_id
     WHERE a.page_id=p.page_id AND a.user_id=auth.uid() AND i.page_id=a.page_id AND i.recipient_id=a.user_id
      AND i.inviter_id=p.owner_id AND i.status='accepted'))
 );
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_team_invitation(uuid,uuid),public.create_creator_page_team_invitation(uuid,uuid,uuid),public.resolve_creator_page_team_invitation(uuid,uuid,text),public.get_creator_page_team_invitation_attempt(uuid,uuid),public.list_my_creator_page_team_invitations(),public.creator_page_team_can_manage(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_team_invitation(uuid,uuid),public.create_creator_page_team_invitation(uuid,uuid,uuid),public.resolve_creator_page_team_invitation(uuid,uuid,text),public.get_creator_page_team_invitation_attempt(uuid,uuid),public.list_my_creator_page_team_invitations(),public.creator_page_team_can_manage(uuid,text) TO authenticated;

CREATE FUNCTION public.get_creator_page_team(p_page_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications; u uuid:=auth.uid();
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF u IS NULL OR p.page_id IS NULL OR NOT public.creator_page_team_eligible(p_page_id,p.owner_id,u)
 OR NOT (p.owner_id=u OR public.creator_page_team_can_manage(p_page_id,'page_content')
  OR (p.page_kind='community' AND public.is_community_leader(p_page_id,u))) THEN
  RAISE EXCEPTION 'Page team unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('page_id',p.page_id,'page_kind',p.page_kind,'page_name',p.name,'owner_id',p.owner_id,
  'can_invite',p.owner_id=u,
  'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('assignment_id',a.id,'user_id',a.user_id,'invitation_id',a.invitation_id,'accepted_at',a.accepted_at,'role','co_creator',
   'available',public.creator_page_team_eligible(p_page_id,p.owner_id,a.user_id) AND i.inviter_id=p.owner_id AND i.status='accepted') ORDER BY a.accepted_at,a.id),'[]'::jsonb)
   FROM public.creator_page_team_assignments a JOIN public.creator_page_team_invitations i ON i.id=a.invitation_id WHERE a.page_id=p_page_id),
  'legacy_members',(SELECT coalesce(jsonb_agg(jsonb_build_object('member_id',m.id,'user_id',m.user_id,'role',m.role) ORDER BY m.created_at,m.id),'[]'::jsonb)
   FROM public.community_members m WHERE p.page_kind='community' AND m.community_id=p_page_id AND m.role IN('leader','co_leader') AND m.status='active'),
  'invitations',CASE WHEN p.owner_id=u THEN (SELECT coalesce(jsonb_agg(
    CASE WHEN public.creator_page_team_eligible(p_page_id,p.owner_id,i.recipient_id) THEN public.creator_page_team_receipt(i)||jsonb_build_object('available',true)
    ELSE jsonb_build_object('invitation_id',i.id,'recipient_id',i.recipient_id,'status',i.status,'available',false) END ORDER BY i.created_at DESC,i.id),'[]'::jsonb)
   FROM public.creator_page_team_invitations i WHERE i.page_id=p_page_id AND i.inviter_id=u) ELSE '[]'::jsonb END);
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_team(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_team(uuid) TO authenticated;

COMMIT;
