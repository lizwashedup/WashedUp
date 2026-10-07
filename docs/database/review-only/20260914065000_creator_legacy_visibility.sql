-- LOCAL / REVIEW ONLY. Correct the publication guard for mixed-target legacy tables.
-- Their original permissive SELECT policies still determine who may read each row.
BEGIN;
ALTER POLICY creator_bound_page_visibility ON public.follower_broadcasts USING (
 community_id IS NULL OR public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid())
);
ALTER POLICY creator_bound_page_visibility ON public.organizer_follows USING (
 community_id IS NULL OR public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid())
);
COMMIT;
