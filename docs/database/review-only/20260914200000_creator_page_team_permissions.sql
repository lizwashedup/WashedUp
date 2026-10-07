-- LOCAL / REVIEW ONLY. September 15 explicit owner-selected page permissions.
-- No inferred full grant, legacy role backfill, membership, financial or provider writes.
BEGIN;
ALTER TABLE public.creator_page_team_invitations ADD COLUMN permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.creator_page_team_invite_attempts ADD COLUMN request_permissions text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.creator_page_team_assignments ADD COLUMN permissions text[] NOT NULL DEFAULT '{}', ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0), ADD COLUMN revoked_at timestamptz;
-- Empty defaults deliberately confer no authority to any earlier proposal rows.
ALTER TABLE public.creator_page_team_assignments DROP CONSTRAINT creator_page_team_assignments_page_id_user_id_key;
CREATE UNIQUE INDEX creator_page_team_one_active_assignment ON public.creator_page_team_assignments(page_id,user_id) WHERE revoked_at IS NULL;
CREATE TABLE public.creator_page_team_access_changes (
 request_id uuid PRIMARY KEY, page_id uuid NOT NULL, owner_id uuid NOT NULL, assignment_id uuid NOT NULL,
 expected_revision integer NOT NULL, action text NOT NULL CHECK(action IN('edit','revoke')),
 permissions text[] NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.creator_page_team_access_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_team_access_changes FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.creator_page_team_validate_permissions(p_kind text,p_permissions text[],p_allow_empty boolean DEFAULT false) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE normalized text[];
BEGIN
 IF p_permissions IS NULL OR array_ndims(p_permissions)>1 OR array_position(p_permissions,NULL) IS NOT NULL
 OR NOT (p_permissions <@ CASE WHEN p_kind='community' THEN ARRAY['page_content','page_events','membership_requests'] ELSE ARRAY['page_content','page_events'] END)
 OR (NOT p_allow_empty AND cardinality(p_permissions)=0) THEN RAISE EXCEPTION 'Choose permissions for this page' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(x ORDER BY x),'{}') INTO normalized FROM (SELECT DISTINCT unnest(p_permissions) x) a;
 IF cardinality(normalized)<>cardinality(p_permissions) THEN RAISE EXCEPTION 'Choose each permission once' USING ERRCODE='22023'; END IF;
 RETURN normalized;
END;
$$;
REVOKE ALL ON FUNCTION public.creator_page_team_validate_permissions(text,text[],boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.creator_page_team_receipt(p_invite public.creator_page_team_invitations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('invitation_id',p_invite.id,'page_id',p_invite.page_id,'page_kind',p.page_kind,'page_name',p.name,
  'inviter_id',p_invite.inviter_id,'recipient_id',p_invite.recipient_id,'role','co_creator',
  'status',CASE WHEN p_invite.status='pending' AND p_invite.expires_at<=now() THEN 'expired' ELSE p_invite.status END,
  'created_at',p_invite.created_at,'expires_at',p_invite.expires_at,'resolved_at',CASE WHEN p_invite.status='pending' AND p_invite.expires_at<=now() THEN p_invite.expires_at ELSE p_invite.resolved_at END,
  'permissions',p_invite.permissions,'current_permissions',(SELECT a.permissions FROM public.creator_page_team_assignments a WHERE a.invitation_id=p_invite.id),'access_revoked_at',(SELECT a.revoked_at FROM public.creator_page_team_assignments a WHERE a.invitation_id=p_invite.id),'note',p_invite.note,'inviter_name',(SELECT f.first_name_display FROM public.profiles f WHERE f.id=p_invite.inviter_id),'recipient_name',(SELECT f.first_name_display FROM public.profiles f WHERE f.id=p_invite.recipient_id),
  'assignment_id',(SELECT a.id FROM public.creator_page_team_assignments a WHERE a.invitation_id=p_invite.id))
 FROM public.creator_page_publications p WHERE p.page_id=p_invite.page_id;
$$;
CREATE OR REPLACE FUNCTION public.create_creator_page_team_invitation_with_permissions(p_page_id uuid,p_request_id uuid,p_recipient_id uuid,p_note text,p_permissions text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); p public.creator_page_publications; i public.creator_page_team_invitations; a public.creator_page_team_invite_attempts; chosen text[]; n text:=btrim(coalesce(p_note,''));
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_recipient_id IS NULL OR p_recipient_id=u THEN RAISE EXCEPTION 'Choose another existing account' USING ERRCODE='22023'; END IF;
 -- Serialize invitation/response operations per page, retaining existing event locks.
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id FOR UPDATE;
 IF p.page_id IS NULL OR p.owner_id<>u OR NOT public.creator_page_team_eligible(p_page_id,u,p_recipient_id) THEN
  RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501'; END IF;
 chosen:=public.creator_page_team_validate_permissions(p.page_kind,p_permissions);
 IF char_length(n)>1000 THEN RAISE EXCEPTION 'Keep the note to 1000 characters' USING ERRCODE='22023'; END IF;
 PERFORM public.get_creator_page_team_recipient(p_page_id,p_recipient_id);
 SELECT * INTO a FROM public.creator_page_team_invite_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.inviter_id<>u OR a.recipient_id<>p_recipient_id OR a.request_note<>n OR a.request_permissions<>chosen THEN
   RAISE EXCEPTION 'Invitation attempt does not match' USING ERRCODE='22023'; END IF;
  RETURN public.get_creator_page_team_invitation(p_page_id,a.invitation_id);
 END IF;
 IF p.page_kind='community' AND EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=p_page_id AND m.user_id=p_recipient_id AND m.role IN('leader','co_leader') AND m.status='active') THEN
  RAISE EXCEPTION 'This person already has community team access' USING ERRCODE='PT409'; END IF;
 -- A new explicit attempt can refer to an existing pending/accepted record;
 -- its own mapping ensures a lost create response can resolve the same identity.
 SELECT inv.* INTO i FROM public.creator_page_team_invitations inv
 JOIN public.creator_page_team_assignments g ON g.invitation_id=inv.id
 WHERE g.page_id=p_page_id AND g.user_id=p_recipient_id AND g.revoked_at IS NULL AND inv.inviter_id=u;
 IF i.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.creator_page_team_assignments WHERE page_id=p_page_id AND user_id=p_recipient_id AND revoked_at IS NULL) THEN
   RAISE EXCEPTION 'Page team requires review' USING ERRCODE='PT409'; END IF;
  UPDATE public.creator_page_team_invitations SET status='expired',resolved_at=expires_at
   WHERE page_id=p_page_id AND recipient_id=p_recipient_id AND status='pending' AND expires_at<=now();
  SELECT * INTO i FROM public.creator_page_team_invitations WHERE page_id=p_page_id AND recipient_id=p_recipient_id AND status='pending';
  IF i.id IS NOT NULL AND i.inviter_id<>u THEN RAISE EXCEPTION 'Page team requires review' USING ERRCODE='PT409'; END IF;
  IF i.id IS NULL THEN
   INSERT INTO public.creator_page_team_invitations(id,page_id,inviter_id,recipient_id,note,permissions)
    VALUES(p_request_id,p_page_id,u,p_recipient_id,n,chosen) RETURNING * INTO i;
  END IF;
 END IF;
 INSERT INTO public.creator_page_team_invite_attempts(request_id,page_id,inviter_id,recipient_id,invitation_id,request_note,request_permissions)
  VALUES(p_request_id,p_page_id,u,p_recipient_id,i.id,n,chosen) ON CONFLICT(request_id) DO NOTHING;
 SELECT * INTO a FROM public.creator_page_team_invite_attempts WHERE request_id=p_request_id;
 IF a.page_id<>p_page_id OR a.inviter_id<>u OR a.recipient_id<>p_recipient_id OR a.invitation_id<>i.id THEN
  RAISE EXCEPTION 'Invitation attempt does not match' USING ERRCODE='22023'; END IF;
 RETURN public.get_creator_page_team_invitation(p_page_id,i.id);
END;
$$;
CREATE OR REPLACE FUNCTION public.create_creator_page_team_invitation(p_page_id uuid,p_request_id uuid,p_recipient_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Choose page permissions in the updated invitation flow' USING ERRCODE='22023'; END; $$;
CREATE OR REPLACE FUNCTION public.create_creator_page_team_invitation_with_note(p_page_id uuid,p_request_id uuid,p_recipient_id uuid,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'Choose page permissions in the updated invitation flow' USING ERRCODE='22023'; END; $$;
CREATE OR REPLACE FUNCTION public.resolve_creator_page_team_invitation(p_page_id uuid,p_invitation_id uuid,p_action text) RETURNS jsonb
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
  PERFORM public.creator_page_team_validate_permissions((SELECT page_kind FROM public.creator_page_publications WHERE page_id=i.page_id),i.permissions);
  INSERT INTO public.creator_page_team_assignments(page_id,user_id,invitation_id,permissions) VALUES(i.page_id,i.recipient_id,i.id,i.permissions);
 END IF;
 UPDATE public.creator_page_team_invitations SET status=desired,resolved_at=now() WHERE id=i.id RETURNING * INTO i;
 RETURN public.creator_page_team_receipt(i);
END;
$$;
CREATE OR REPLACE FUNCTION public.creator_page_team_can_manage(p_page_id uuid,p_capability text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce(p_capability IN('page_content','page_events','membership_requests'),false) AND EXISTS(
  SELECT 1 FROM public.creator_page_publications p WHERE p.page_id=p_page_id
   AND (p_capability<>'membership_requests' OR p.page_kind='community')
   AND public.creator_page_team_eligible(p.page_id,p.owner_id,auth.uid())
   AND (p.owner_id=auth.uid() OR EXISTS(SELECT 1 FROM public.creator_page_team_assignments a
     JOIN public.creator_page_team_invitations i ON i.id=a.invitation_id
     WHERE a.page_id=p.page_id AND a.user_id=auth.uid() AND i.page_id=a.page_id AND i.recipient_id=a.user_id
      AND i.inviter_id=p.owner_id AND i.status='accepted' AND a.revoked_at IS NULL AND p_capability=ANY(a.permissions)))
 );
$$;
CREATE OR REPLACE FUNCTION public.get_creator_page_team(p_page_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications; u uuid:=auth.uid();
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF u IS NULL OR p.page_id IS NULL OR NOT public.creator_page_team_eligible(p_page_id,p.owner_id,u)
 OR NOT (p.owner_id=u OR public.creator_page_team_can_manage(p_page_id,'page_content') OR public.creator_page_team_can_manage(p_page_id,'page_events') OR public.creator_page_team_can_manage(p_page_id,'membership_requests')
  OR (p.page_kind='community' AND public.is_community_leader(p_page_id,u))) THEN
  RAISE EXCEPTION 'Page team unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('page_id',p.page_id,'page_kind',p.page_kind,'page_name',p.name,'owner_id',p.owner_id,
  'owner_name',(SELECT first_name_display FROM public.profiles WHERE id=p.owner_id),'can_invite',p.owner_id=u,
  'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('assignment_id',a.id,'user_id',a.user_id,'name',CASE WHEN public.creator_page_team_eligible(p_page_id,p.owner_id,a.user_id) THEN (SELECT first_name_display FROM public.profiles WHERE id=a.user_id) END,'invitation_id',a.invitation_id,'accepted_at',a.accepted_at,'permissions',a.permissions,'revision',a.revision,'revoked_at',a.revoked_at,'role','co_creator',
   'available',public.creator_page_team_eligible(p_page_id,p.owner_id,a.user_id) AND i.inviter_id=p.owner_id AND i.status='accepted' AND a.revoked_at IS NULL AND cardinality(a.permissions)>0) ORDER BY a.accepted_at,a.id),'[]'::jsonb)
   FROM public.creator_page_team_assignments a JOIN public.creator_page_team_invitations i ON i.id=a.invitation_id WHERE a.page_id=p_page_id),
  'legacy_members',(SELECT coalesce(jsonb_agg(jsonb_build_object('member_id',m.id,'user_id',m.user_id,'name',CASE WHEN public.creator_page_team_eligible(p_page_id,p.owner_id,m.user_id) THEN (SELECT first_name_display FROM public.profiles WHERE id=m.user_id) END,'role',m.role) ORDER BY m.created_at,m.id),'[]'::jsonb)
   FROM public.community_members m WHERE p.page_kind='community' AND m.community_id=p_page_id AND m.role IN('leader','co_leader') AND m.status='active'),
  'invitations',CASE WHEN p.owner_id=u THEN (SELECT coalesce(jsonb_agg(
    CASE WHEN public.creator_page_team_eligible(p_page_id,p.owner_id,i.recipient_id) THEN public.creator_page_team_receipt(i)||jsonb_build_object('available',true)
    ELSE jsonb_build_object('invitation_id',i.id,'recipient_id',i.recipient_id,'status',i.status,'available',false) END ORDER BY i.created_at DESC,i.id),'[]'::jsonb)
   FROM public.creator_page_team_invitations i WHERE i.page_id=p_page_id AND i.inviter_id=u) ELSE '[]'::jsonb END);
END;
$$;
CREATE FUNCTION public.get_creator_page_team_access_change(p_page_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications; c public.creator_page_team_access_changes;
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF auth.uid() IS NULL OR p.owner_id IS DISTINCT FROM auth.uid() OR NOT public.creator_page_team_eligible(p_page_id,auth.uid(),auth.uid()) THEN RAISE EXCEPTION 'Page team unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.creator_page_team_access_changes WHERE request_id=p_request_id;
 IF c.request_id IS NULL THEN RETURN NULL; END IF;
 IF c.page_id<>p_page_id OR c.owner_id<>auth.uid() THEN RAISE EXCEPTION 'Access change unavailable' USING ERRCODE='42501'; END IF;
 RETURN c.receipt;
END;
$$;
CREATE FUNCTION public.change_creator_page_team_access(p_page_id uuid,p_request_id uuid,p_assignment_id uuid,p_expected_revision integer,p_action text,p_permissions text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications; a public.creator_page_team_assignments; c public.creator_page_team_access_changes; chosen text[]; result jsonb;
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id FOR UPDATE;
 IF auth.uid() IS NULL OR p.owner_id IS DISTINCT FROM auth.uid() OR NOT public.creator_page_team_eligible(p_page_id,auth.uid(),auth.uid()) THEN RAISE EXCEPTION 'Page team unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_assignment_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 OR p_action IS NULL OR p_action NOT IN('edit','revoke') THEN RAISE EXCEPTION 'Check the access change' USING ERRCODE='22023'; END IF;
 chosen:=public.creator_page_team_validate_permissions(p.page_kind,p_permissions,p_action='revoke');
 IF p_action='revoke' AND cardinality(chosen)<>0 THEN RAISE EXCEPTION 'Revocation grants no permissions' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.creator_page_team_access_changes WHERE request_id=p_request_id;
 IF c.request_id IS NOT NULL THEN
  IF c.page_id<>p_page_id OR c.owner_id<>auth.uid() OR c.assignment_id<>p_assignment_id OR c.expected_revision<>p_expected_revision OR c.action<>p_action OR c.permissions<>chosen THEN RAISE EXCEPTION 'Access change attempt does not match' USING ERRCODE='22023'; END IF;
  RETURN c.receipt;
 END IF;
 SELECT * INTO a FROM public.creator_page_team_assignments WHERE id=p_assignment_id AND page_id=p_page_id FOR UPDATE;
 IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.creator_page_team_invitations i WHERE i.id=a.invitation_id AND i.page_id=a.page_id AND i.recipient_id=a.user_id AND i.inviter_id=p.owner_id AND i.status='accepted') THEN RAISE EXCEPTION 'Page access unavailable' USING ERRCODE='42501'; END IF;
 IF a.revision<>p_expected_revision OR a.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Page access changed. Refresh before editing.' USING ERRCODE='PT409'; END IF;
 -- Owner can revoke even when recipient is blocked/banned/no longer eligible.
 IF p_action='edit' AND NOT public.creator_page_team_eligible(p_page_id,p.owner_id,a.user_id) THEN RAISE EXCEPTION 'Person unavailable for this page' USING ERRCODE='42501'; END IF;
 UPDATE public.creator_page_team_assignments SET permissions=chosen,revision=revision+1,revoked_at=CASE WHEN p_action='revoke' THEN now() ELSE NULL END WHERE id=a.id RETURNING * INTO a;
 result:=jsonb_build_object('request_id',p_request_id,'page_id',p_page_id,'owner_id',auth.uid(),'assignment_id',a.id,'user_id',a.user_id,'expected_revision',p_expected_revision,'revision',a.revision,'action',p_action,'permissions',a.permissions,'revoked_at',a.revoked_at);
 INSERT INTO public.creator_page_team_access_changes(request_id,page_id,owner_id,assignment_id,expected_revision,action,permissions,receipt) VALUES(p_request_id,p_page_id,auth.uid(),a.id,p_expected_revision,p_action,chosen,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_creator_page_team_invitation_with_permissions(uuid,uuid,uuid,text,text[]),public.get_creator_page_team_access_change(uuid,uuid),public.change_creator_page_team_access(uuid,uuid,uuid,integer,text,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_creator_page_team_invitation_with_permissions(uuid,uuid,uuid,text,text[]),public.get_creator_page_team_access_change(uuid,uuid),public.change_creator_page_team_access(uuid,uuid,uuid,integer,text,text[]) TO authenticated;
COMMIT;
