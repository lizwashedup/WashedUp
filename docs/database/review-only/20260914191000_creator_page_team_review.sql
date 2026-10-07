-- LOCAL / REVIEW ONLY. Approved team form: eligible existing account + optional note.
-- Retain all previous signatures, direct grants, attempts and legacy search behavior.
BEGIN;
ALTER TABLE public.creator_page_team_invitations ADD COLUMN note text NOT NULL DEFAULT '' CHECK(char_length(note)<=1000);
ALTER TABLE public.creator_page_team_invite_attempts ADD COLUMN request_note text NOT NULL DEFAULT '' CHECK(char_length(request_note)<=1000);
CREATE OR REPLACE FUNCTION public.creator_page_team_receipt(p_invite public.creator_page_team_invitations) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('invitation_id',p_invite.id,'page_id',p_invite.page_id,'page_kind',p.page_kind,'page_name',p.name,
  'inviter_id',p_invite.inviter_id,'recipient_id',p_invite.recipient_id,'role','co_creator',
  'status',CASE WHEN p_invite.status='pending' AND p_invite.expires_at<=now() THEN 'expired' ELSE p_invite.status END,
  'created_at',p_invite.created_at,'expires_at',p_invite.expires_at,'resolved_at',CASE WHEN p_invite.status='pending' AND p_invite.expires_at<=now() THEN p_invite.expires_at ELSE p_invite.resolved_at END,
  'note',p_invite.note,'inviter_name',(SELECT f.first_name_display FROM public.profiles f WHERE f.id=p_invite.inviter_id),'recipient_name',(SELECT f.first_name_display FROM public.profiles f WHERE f.id=p_invite.recipient_id),
  'assignment_id',(SELECT a.id FROM public.creator_page_team_assignments a WHERE a.invitation_id=p_invite.id))
 FROM public.creator_page_publications p WHERE p.page_id=p_invite.page_id;
$$;
CREATE FUNCTION public.get_creator_page_team_recipient(p_page_id uuid,p_recipient_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications; f public.profiles;
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF auth.uid() IS NULL OR p.owner_id IS DISTINCT FROM auth.uid() OR p_recipient_id=auth.uid()
 OR NOT public.creator_page_team_eligible(p_page_id,auth.uid(),p_recipient_id) THEN
  RAISE EXCEPTION 'Person unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.profiles WHERE id=p_recipient_id AND onboarding_status='complete';
 IF f.id IS NULL THEN RAISE EXCEPTION 'Person unavailable for this page' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('page_id',p_page_id,'user_id',f.id,'name',f.first_name_display,'photo_url',f.profile_photo_url);
END;
$$;
CREATE FUNCTION public.find_creator_page_team_recipient(p_page_id uuid,p_handle text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications; uid uuid; h text:=lower(btrim(p_handle));
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF auth.uid() IS NULL OR p.owner_id IS DISTINCT FROM auth.uid() OR NOT public.creator_page_team_eligible(p_page_id,auth.uid(),auth.uid()) THEN
  RAISE EXCEPTION 'Page team unavailable' USING ERRCODE='42501'; END IF;
 IF left(h,1)='@' THEN h:=substr(h,2); END IF;
 IF h IS NULL OR h='' OR char_length(h)>64 THEN RETURN NULL; END IF;
 -- Exact equality: percent and underscore are literal characters, not wildcards.
 SELECT f.id INTO uid FROM public.profiles f WHERE lower(f.handle)=h AND f.id<>auth.uid() AND f.onboarding_status='complete'
  AND public.creator_page_team_eligible(p_page_id,auth.uid(),f.id);
 IF uid IS NULL THEN RETURN NULL; END IF;
 RETURN public.get_creator_page_team_recipient(p_page_id,uid);
END;
$$;
CREATE FUNCTION public.create_creator_page_team_invitation_with_note(p_page_id uuid,p_request_id uuid,p_recipient_id uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_team_invite_attempts; r jsonb; n text:=btrim(coalesce(p_note,'')); fresh boolean;
BEGIN
 IF char_length(n)>1000 THEN RAISE EXCEPTION 'Keep the note to 1000 characters' USING ERRCODE='22023'; END IF;
 -- Reuse the exact-account eligibility and original serialized creation path.
 PERFORM public.get_creator_page_team_recipient(p_page_id,p_recipient_id);
 PERFORM 1 FROM public.creator_page_publications WHERE page_id=p_page_id FOR UPDATE;
 SELECT * INTO a FROM public.creator_page_team_invite_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.inviter_id<>auth.uid() OR a.recipient_id<>p_recipient_id OR a.request_note<>n THEN
   RAISE EXCEPTION 'Invitation attempt does not match' USING ERRCODE='22023'; END IF;
  RETURN public.get_creator_page_team_invitation(p_page_id,a.invitation_id);
 END IF;
 fresh:=NOT EXISTS(SELECT 1 FROM public.creator_page_team_invitations WHERE id=p_request_id);
 r:=public.create_creator_page_team_invitation(p_page_id,p_request_id,p_recipient_id);
 IF fresh AND r->>'invitation_id'=p_request_id::text THEN
  UPDATE public.creator_page_team_invitations SET note=n WHERE id=p_request_id;
 END IF;
 UPDATE public.creator_page_team_invite_attempts SET request_note=n WHERE request_id=p_request_id AND inviter_id=auth.uid() AND page_id=p_page_id AND recipient_id=p_recipient_id;
 RETURN public.get_creator_page_team_invitation(p_page_id,(r->>'invitation_id')::uuid);
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_team_recipient(uuid,uuid),public.find_creator_page_team_recipient(uuid,text),public.create_creator_page_team_invitation_with_note(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_team_recipient(uuid,uuid),public.find_creator_page_team_recipient(uuid,text),public.create_creator_page_team_invitation_with_note(uuid,uuid,uuid,text) TO authenticated;
COMMIT;
