-- Isolated review candidate. Reuse admission and selected page permissions.
BEGIN;
CREATE FUNCTION public.get_creator_page_join_requests(p_page_id uuid, p_member_id uuid DEFAULT NULL, p_after_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE page public.creator_page_publications; anchor public.community_members; rows jsonb; more boolean;
BEGIN
 SELECT * INTO page FROM public.creator_page_publications WHERE page_id=p_page_id AND page_kind='community';
 IF page.page_id IS NULL OR NOT public.creator_page_team_can_manage(p_page_id,'membership_requests') THEN
  RAISE EXCEPTION 'Page requests unavailable' USING ERRCODE='42501';
 END IF;
 IF p_member_id IS NOT NULL AND p_after_id IS NOT NULL THEN RAISE EXCEPTION 'Choose one request or a list' USING ERRCODE='22023'; END IF;
 IF p_after_id IS NOT NULL THEN
  SELECT * INTO anchor FROM public.community_members WHERE id=p_after_id AND community_id=p_page_id;
  IF anchor.id IS NULL THEN RAISE EXCEPTION 'Refresh the request list' USING ERRCODE='22023'; END IF;
 END IF;
 WITH selected AS (
  SELECT m.* FROM public.community_members m WHERE m.community_id=p_page_id
   AND CASE WHEN p_member_id IS NOT NULL THEN m.id=p_member_id ELSE m.status='pending' END
   AND (p_after_id IS NULL OR (m.created_at,m.id)>(anchor.created_at,anchor.id))
  ORDER BY m.created_at,m.id LIMIT 51
 ), numbered AS (SELECT selected.*,row_number() OVER(ORDER BY created_at,id) position FROM selected)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'member_id',m.id,'user_id',m.user_id,'status',m.status,'created_at',m.created_at,'updated_at',m.updated_at,
   'first_name',a.answers->>'first_name','last_name',a.answers->>'last_name',
   'intro_answer',a.answers->>'intro_answer','reason_answer',a.answers->>'reason_answer',
   'source_answer',a.answers->>'source_answer','open_question',a.answers->>'open_question',
   'open_answer',a.answers->>'open_answer','rules_confirmed',a.answers->'rules_confirmed',
   'guidelines_accepted_at',a.answers->>'guidelines_accepted_at'
  ) ORDER BY m.created_at,m.id) FILTER(WHERE m.position<=50),'[]'::jsonb),coalesce(bool_or(m.position>50),false)
 INTO rows,more FROM numbered m LEFT JOIN public.community_member_answers a
  ON a.member_id=m.id AND a.community_id=m.community_id AND a.user_id=m.user_id AND m.status='pending';
 RETURN jsonb_build_object('page_id',page.page_id,'page_name',page.name,'requests',rows,
  'next_cursor',CASE WHEN more THEN rows->49->>'member_id' ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_join_requests(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_join_requests(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.review_creator_page_join_request(p_page_id uuid,p_member_id uuid,p_approve boolean,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE page public.creator_page_publications; member public.community_members;
BEGIN
 IF p_approve IS NULL OR p_member_id IS NULL OR p_expected_updated_at IS NULL THEN RAISE EXCEPTION 'Choose a request and decision' USING ERRCODE='22023'; END IF;
 -- Same first lock as owner permission editing/revocation, then existing admission order.
 SELECT * INTO page FROM public.creator_page_publications WHERE page_id=p_page_id AND page_kind='community' FOR UPDATE;
 IF page.page_id IS NULL OR NOT public.creator_page_team_can_manage(p_page_id,'membership_requests') THEN
  RAISE EXCEPTION 'Page requests unavailable' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.communities WHERE id=p_page_id FOR UPDATE;
 SELECT * INTO member FROM public.community_members WHERE id=p_member_id AND community_id=p_page_id FOR UPDATE;
 IF member.id IS NULL THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 IF NOT public.creator_page_team_can_manage(p_page_id,'membership_requests') THEN RAISE EXCEPTION 'Page access changed' USING ERRCODE='42501'; END IF;
 IF member.status<>'pending' THEN
  -- A repeated same decision confirms current state; never repeats its effects.
  IF (p_approve AND member.status='active') OR (NOT p_approve AND member.status='declined') THEN
   RETURN jsonb_build_object('page_id',p_page_id,'member_id',member.id,'status',member.status,'changed',false);
  END IF;
  RAISE EXCEPTION 'This request was already handled. Check its status.' USING ERRCODE='P0001';
 END IF;
 IF member.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'This request changed. Review the current answers.' USING ERRCODE='PT409';
 END IF;
 IF p_approve THEN
  IF NOT public.creator_page_team_eligible(p_page_id,page.owner_id,member.user_id) THEN
   RAISE EXCEPTION 'This person is no longer eligible to join this page' USING ERRCODE='42501';
  END IF;
  PERFORM public.finalize_community_join(member.id,auth.uid(),false);
 ELSE
  UPDATE public.community_members SET status='declined' WHERE id=member.id;
  INSERT INTO public.app_notifications(user_id,type,title,body,actor_user_id)
  VALUES(member.user_id,'community_join_declined','about your request',
   'not this time, and that''s okay. there are more communities to find.',auth.uid());
 END IF;
 RETURN jsonb_build_object('page_id',p_page_id,'member_id',member.id,'status',CASE WHEN p_approve THEN 'active' ELSE 'declined' END,'changed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.review_creator_page_join_request(uuid,uuid,boolean,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.review_creator_page_join_request(uuid,uuid,boolean,timestamptz) TO authenticated;
COMMIT;
