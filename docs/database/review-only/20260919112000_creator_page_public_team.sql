-- Private review candidate: public identity only, no handles/contact/permissions.
BEGIN;
CREATE FUNCTION public.get_creator_page_public_team(p_page_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH page AS (
  SELECT p.* FROM public.creator_page_publications p WHERE p.page_id=p_page_id AND public.creator_page_is_visible(p.page_id)
 ), people AS (
  SELECT p.owner_id user_id,'creator'::text role,0 rank FROM page p
  UNION
  SELECT a.user_id,'co_creator',1 FROM page p JOIN public.creator_page_team_assignments a ON a.page_id=p.page_id
  WHERE a.revoked_at IS NULL AND cardinality(a.permissions)>0
   AND public.creator_page_team_eligible(p.page_id,p.owner_id,a.user_id)
  UNION
  SELECT m.user_id,'co_creator',1 FROM page p JOIN public.community_members m ON m.community_id=p.page_id
  WHERE p.page_kind='community' AND m.status='active' AND m.role='co_leader' AND m.user_id<>p.owner_id
   AND public.creator_page_team_eligible(p.page_id,p.owner_id,m.user_id)
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.first_name_display,'photo',f.profile_photo_url,'role',p.role) ORDER BY p.rank,f.first_name_display,f.id),'[]')
 FROM people p JOIN public.profiles f ON f.id=p.user_id JOIN auth.users u ON u.id=p.user_id
 WHERE u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
 AND (auth.uid() IS NULL OR NOT public.yours_is_blocked_between(auth.uid(),f.id));
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_public_team(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_public_team(uuid) TO anon,authenticated;
COMMIT;
