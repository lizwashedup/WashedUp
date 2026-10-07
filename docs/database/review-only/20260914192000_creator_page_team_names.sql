-- LOCAL / REVIEW ONLY. Authorized team roster display names; never handles.
-- Retains current page/recipient authorization and all existing role identities.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_creator_page_team(p_page_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications; u uuid:=auth.uid();
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF u IS NULL OR p.page_id IS NULL OR NOT public.creator_page_team_eligible(p_page_id,p.owner_id,u)
 OR NOT (p.owner_id=u OR public.creator_page_team_can_manage(p_page_id,'page_content')
  OR (p.page_kind='community' AND public.is_community_leader(p_page_id,u))) THEN
  RAISE EXCEPTION 'Page team unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('page_id',p.page_id,'page_kind',p.page_kind,'page_name',p.name,'owner_id',p.owner_id,
  'owner_name',(SELECT first_name_display FROM public.profiles WHERE id=p.owner_id),'can_invite',p.owner_id=u,
  'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('assignment_id',a.id,'user_id',a.user_id,'name',CASE WHEN public.creator_page_team_eligible(p_page_id,p.owner_id,a.user_id) THEN (SELECT first_name_display FROM public.profiles WHERE id=a.user_id) END,'invitation_id',a.invitation_id,'accepted_at',a.accepted_at,'role','co_creator',
   'available',public.creator_page_team_eligible(p_page_id,p.owner_id,a.user_id) AND i.inviter_id=p.owner_id AND i.status='accepted') ORDER BY a.accepted_at,a.id),'[]'::jsonb)
   FROM public.creator_page_team_assignments a JOIN public.creator_page_team_invitations i ON i.id=a.invitation_id WHERE a.page_id=p_page_id),
  'legacy_members',(SELECT coalesce(jsonb_agg(jsonb_build_object('member_id',m.id,'user_id',m.user_id,'name',CASE WHEN public.creator_page_team_eligible(p_page_id,p.owner_id,m.user_id) THEN (SELECT first_name_display FROM public.profiles WHERE id=m.user_id) END,'role',m.role) ORDER BY m.created_at,m.id),'[]'::jsonb)
   FROM public.community_members m WHERE p.page_kind='community' AND m.community_id=p_page_id AND m.role IN('leader','co_leader') AND m.status='active'),
  'invitations',CASE WHEN p.owner_id=u THEN (SELECT coalesce(jsonb_agg(
    CASE WHEN public.creator_page_team_eligible(p_page_id,p.owner_id,i.recipient_id) THEN public.creator_page_team_receipt(i)||jsonb_build_object('available',true)
    ELSE jsonb_build_object('invitation_id',i.id,'recipient_id',i.recipient_id,'status',i.status,'available',false) END ORDER BY i.created_at DESC,i.id),'[]'::jsonb)
   FROM public.creator_page_team_invitations i WHERE i.page_id=p_page_id AND i.inviter_id=u) ELSE '[]'::jsonb END);
END;
$$;
COMMIT;
