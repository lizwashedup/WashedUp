-- REVIEW ONLY: preserve existing account/community FK cleanup while rejecting
-- client identity changes. No new deletion permission or lifecycle action.
-- Two measured pre-110 defects: recovered broadcast identity guard, and the
-- earlier local creator-page publication guard (030). Local verification only.
BEGIN;
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.community_broadcast_identity_immutable()'::regprocedure))<>'cee86f775a3b5cf3c87d2ab9ad57d6f4' THEN RAISE EXCEPTION 'Unexpected community_broadcast_identity_immutable definition; inspect before changing it'; END IF;
 IF md5(pg_get_functiondef('public.creator_page_event_publication_guard()'::regprocedure))<>'cc2d0525222c6e0395acdd7ee0bc95fa' THEN RAISE EXCEPTION 'Unexpected creator_page_event_publication_guard definition; inspect before changing it'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.community_broadcast_identity_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.community_id IS DISTINCT FROM OLD.community_id
     OR (NEW.sender_id IS DISTINCT FROM OLD.sender_id AND NOT (NEW.sender_id IS NULL AND OLD.sender_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.sender_id)))
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'community message identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.creator_page_event_publication_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_page uuid; p public.creator_page_drafts; v_cleanup boolean := false;
BEGIN
 SELECT page_id INTO v_page FROM public.creator_page_events WHERE event_id=NEW.id;
 IF v_page IS NULL AND NEW.community_id IS NOT NULL THEN
  SELECT id INTO v_page FROM public.creator_page_drafts WHERE id=NEW.community_id;
  IF v_page IS NULL THEN SELECT page_id INTO v_page FROM public.creator_page_publications WHERE page_id=NEW.community_id; END IF;
 END IF;
 IF v_page IS NULL THEN RETURN NEW; END IF; -- Existing unmapped events unchanged.
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=v_page FOR SHARE;
 IF TG_OP='UPDATE' AND (NEW.community_id IS DISTINCT FROM OLD.community_id OR NEW.host_user_id IS DISTINCT FROM OLD.host_user_id
  OR NEW.owner_type IS DISTINCT FROM OLD.owner_type OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
  OR NEW.owner_community_id IS DISTINCT FROM OLD.owner_community_id) THEN
  -- Preserve established FK cleanup/re-homing when an account/community is
  -- actually deleted. A client cannot use nulls to detach a still-existing owner.
  v_cleanup := NEW.owner_type IS NOT DISTINCT FROM OLD.owner_type
   AND (NEW.host_user_id IS NOT DISTINCT FROM OLD.host_user_id OR (NEW.host_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.host_user_id)))
   AND (NEW.community_id IS NOT DISTINCT FROM OLD.community_id OR (NEW.community_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.communities WHERE id=OLD.community_id)))
   AND (NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id OR (NEW.owner_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.owner_user_id)))
   AND (NEW.owner_community_id IS NOT DISTINCT FROM OLD.owner_community_id OR (NEW.owner_community_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.communities WHERE id=OLD.owner_community_id)));
  IF NOT v_cleanup THEN RAISE EXCEPTION 'The saved event must keep its page and creator' USING ERRCODE='PT409'; END IF;
 END IF;
 -- v_cleanup requires the referenced parent to have actually been deleted.
 -- Keep the existing FK action possible; ordinary updates still require publication.
 IF NOT v_cleanup AND NEW.status='Live' AND NOT EXISTS(SELECT 1 FROM public.creator_page_publications pub WHERE pub.page_id=v_page
   AND (pub.page_kind='organization' OR EXISTS(SELECT 1 FROM public.communities c WHERE c.id=v_page AND c.status='active'))) THEN
  RAISE EXCEPTION 'Publish the approved page before its event' USING ERRCODE='PT409'; END IF;
 IF NOT v_cleanup AND auth.uid() IS NOT NULL AND NOT public.creator_page_audience_matches(
  coalesce((SELECT audience FROM public.creator_page_publications WHERE page_id=v_page),p.page_data->>'audience','everyone'),auth.uid()) THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.community_broadcast_identity_immutable(),public.creator_page_event_publication_guard() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
