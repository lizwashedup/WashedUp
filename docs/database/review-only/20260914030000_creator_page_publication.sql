-- LOCAL / REVIEW ONLY: D12-D15 page publication and the same saved event.
-- Depends on 20260914020000_creator_page_review.sql. No legacy backfill.
BEGIN;
CREATE TABLE public.creator_page_publications (
  page_id uuid PRIMARY KEY, -- durable public identity survives private-account cleanup
  submission_id uuid UNIQUE REFERENCES public.creator_page_submissions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  page_kind text NOT NULL CHECK (page_kind IN ('community','organization')),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL, purpose text NOT NULL, city text NOT NULL,
  description text, photo_url text,
  audience text NOT NULL CHECK (audience IN ('everyone','women_only','men_only','nonbinary_only')),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.creator_page_events (
  event_id uuid PRIMARY KEY REFERENCES public.explore_events(id) ON DELETE CASCADE,
  page_id uuid NOT NULL, -- private draft or durable publication; only controlled RPCs insert links
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creator_page_events_page ON public.creator_page_events(page_id);
REVOKE ALL ON public.creator_page_publications, public.creator_page_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.creator_page_publications,public.creator_page_events TO authenticated,anon;
ALTER TABLE public.creator_page_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_page_events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.creator_page_audience_matches(p_audience text, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE p_audience WHEN 'everyone' THEN true
 WHEN 'women_only' THEN EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND gender='woman')
 WHEN 'men_only' THEN EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND gender='man')
 WHEN 'nonbinary_only' THEN EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND gender::text IN ('non_binary','non-binary','nonbinary'))
 ELSE false END;
$$;
-- Caller-independent audience helper is private: not an identity lookup API.
REVOKE ALL ON FUNCTION public.creator_page_audience_matches(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.creator_page_is_visible(p_page_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_publications p
 WHERE p.page_id=p_page_id AND public.creator_page_audience_matches(p.audience,auth.uid())
 AND (p.page_kind='organization' OR EXISTS(SELECT 1 FROM public.communities c WHERE c.id=p.page_id AND c.status='active')));
$$;
CREATE FUNCTION public.creator_community_is_visible(p_community_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM public.creator_page_drafts WHERE id=p_community_id)
 OR EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=p_community_id)
 THEN public.creator_page_is_visible(p_community_id)
 ELSE EXISTS(SELECT 1 FROM public.communities c WHERE c.id=p_community_id AND
  (c.status='active' OR public.is_admin(auth.uid()) OR auth.role()='service_role'
   OR EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=c.id AND m.user_id=auth.uid() AND m.status='active'))) END;
$$;
CREATE FUNCTION public.creator_event_page_id(p_event_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(l.page_id,CASE WHEN EXISTS(SELECT 1 FROM public.creator_page_drafts WHERE id=e.community_id)
  OR EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=e.community_id) THEN e.community_id END)
 FROM public.explore_events e LEFT JOIN public.creator_page_events l ON l.event_id=e.id WHERE e.id=p_event_id;
$$;
REVOKE ALL ON FUNCTION public.creator_event_page_id(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.creator_event_is_visible(p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN public.creator_event_page_id(p_event_id) IS NOT NULL
 THEN EXISTS(SELECT 1 FROM public.explore_events e WHERE e.id=p_event_id AND e.status='Live'
  AND public.creator_page_is_visible(public.creator_event_page_id(e.id)))
 ELSE EXISTS(SELECT 1 FROM public.explore_events e WHERE e.id=p_event_id AND
  (e.status='Live' OR e.host_user_id=auth.uid() OR public.is_admin(auth.uid()) OR auth.role()='service_role'
   OR EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=e.community_id
     AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('leader','co_leader')))) END;
$$;
REVOKE ALL ON FUNCTION public.creator_page_is_visible(uuid),public.creator_community_is_visible(uuid),public.creator_event_is_visible(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_page_is_visible(uuid),public.creator_community_is_visible(uuid),public.creator_event_is_visible(uuid) TO anon,authenticated,service_role;
CREATE FUNCTION public.creator_event_owner_is_eligible(p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN public.creator_event_page_id(p_event_id) IS NULL THEN true ELSE EXISTS(
  SELECT 1 FROM (SELECT public.creator_event_page_id(p_event_id) AS page_id) l
  LEFT JOIN public.creator_page_publications pub ON pub.page_id=l.page_id
  LEFT JOIN public.creator_page_drafts d ON d.id=l.page_id
  WHERE public.creator_page_audience_matches(coalesce(pub.audience,CASE WHEN d.id IS NOT NULL THEN coalesce(d.page_data->>'audience','everyone') END),auth.uid())
 ) END;
$$;
REVOKE ALL ON FUNCTION public.creator_event_owner_is_eligible(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.creator_event_can_manage(p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.explore_events e WHERE e.id=p_event_id
 AND public.creator_event_owner_is_eligible(e.id)
 AND (e.host_user_id=auth.uid() OR public.is_community_leader(e.community_id,auth.uid())));
$$;
REVOKE ALL ON FUNCTION public.creator_event_can_manage(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_event_can_manage(uuid) TO anon,authenticated,service_role;
CREATE FUNCTION public.creator_page_is_owned(p_page_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.creator_page_drafts p WHERE p.id=p_page_id AND p.owner_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.creator_page_is_owned(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_page_is_owned(uuid) TO anon,authenticated,service_role;
CREATE POLICY creator_publication_read ON public.creator_page_publications FOR SELECT
 USING(public.creator_page_is_visible(page_id));
CREATE POLICY creator_page_events_read ON public.creator_page_events FOR SELECT
 USING(public.creator_event_is_visible(event_id) OR public.creator_page_is_owned(page_id) OR public.creator_event_can_manage(event_id));

CREATE FUNCTION public.creator_page_validate_audience() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_audience text := coalesce(NEW.page_data->>'audience','everyone');
BEGIN
 IF (NEW.page_kind='organization' AND v_audience<>'everyone')
 OR NOT public.creator_page_audience_matches(v_audience,NEW.owner_id) THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER creator_page_draft_audience BEFORE INSERT OR UPDATE OF page_data ON public.creator_page_drafts
 FOR EACH ROW EXECUTE FUNCTION public.creator_page_validate_audience();

-- Reserve the real community ID for private event ownership before publication.
-- Reuse the existing communities / blocks model, with no active member/leader yet.
CREATE FUNCTION public.ensure_creator_page_community(p_page_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_drafts; v_handle text;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 IF p.id IS NULL OR p.page_kind<>'community' THEN RAISE EXCEPTION 'Community page unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.communities WHERE id=p.id) THEN
  IF NOT EXISTS(SELECT 1 FROM public.communities WHERE id=p.id AND created_by=p.owner_id) THEN RAISE EXCEPTION 'Page identity conflict'; END IF;
  RETURN p.id;
 END IF;
 v_handle := 'page-' || replace(p.id::text,'-','');
 INSERT INTO public.communities(id,handle,name,description,city,purpose,join_policy,created_by,status)
 VALUES(p.id,v_handle,p.page_data->>'name',p.page_data->>'description',p.page_data->>'city',p.page_data->>'purpose',
   coalesce(p.page_data->>'join_policy','open'),p.owner_id,'draft');
 INSERT INTO public.community_blocks(community_id,block_type,position) VALUES
 (p.id,'cover',0),(p.id,'header',1),(p.id,'about',2),(p.id,'events_auto',3),(p.id,'members_auto',4);
 RETURN p.id;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_creator_page_community(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.publish_creator_page(p_page_id uuid,p_submission_id uuid)
RETURNS public.creator_page_publications LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_drafts; s public.creator_page_submissions; result public.creator_page_publications; v_audience text;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 IF auth.uid() IS NULL OR p.id IS NULL OR p.owner_id<>auth.uid() THEN RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.creator_page_submissions WHERE id=p_submission_id AND page_id=p.id FOR UPDATE;
 IF s.id IS NULL OR s.status<>'approved' THEN RAISE EXCEPTION 'This page needs approval before publication' USING ERRCODE='PT409'; END IF;
 v_audience := coalesce(s.page_snapshot->>'audience','everyone');
 IF NOT public.creator_page_audience_matches(v_audience,auth.uid()) THEN RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO result FROM public.creator_page_publications WHERE page_id=p.id;
 IF result.page_id IS NOT NULL THEN
  IF result.submission_id=s.id THEN RETURN result; END IF;
  RAISE EXCEPTION 'This page is already published. Use its page settings.' USING ERRCODE='PT409';
 END IF;
 IF s.revision<>(SELECT max(revision) FROM public.creator_page_submissions WHERE page_id=p.id)
 OR s.page_snapshot<>p.page_data THEN
  RAISE EXCEPTION 'Your current draft differs from the approved page. Review it before publishing.' USING ERRCODE='PT409';
 END IF;
 IF p.page_kind='community' THEN
  PERFORM public.ensure_creator_page_community(p.id);
  UPDATE public.communities SET name=s.page_snapshot->>'name',description=s.page_snapshot->>'description',
   city=s.page_snapshot->>'city',purpose=s.page_snapshot->>'purpose',join_policy=coalesce(s.page_snapshot->>'join_policy','open')
   WHERE id=p.id;
  UPDATE public.community_blocks SET content=jsonb_build_object('images',jsonb_build_array(s.page_snapshot->>'photo_url'))
   WHERE community_id=p.id AND block_type='cover' AND nullif(s.page_snapshot->>'photo_url','') IS NOT NULL;
 END IF;
 INSERT INTO public.creator_page_publications(page_id,submission_id,page_kind,owner_id,name,purpose,city,description,photo_url,audience)
 VALUES(p.id,s.id,p.page_kind,p.owner_id,s.page_snapshot->>'name',s.page_snapshot->>'purpose',s.page_snapshot->>'city',
   s.page_snapshot->>'description',s.page_snapshot->>'photo_url',v_audience) RETURNING * INTO result;
 IF p.page_kind='community' THEN
  UPDATE public.communities SET status='active' WHERE id=p.id;
  INSERT INTO public.community_members(community_id,user_id,role,status,joined_at) VALUES(p.id,p.owner_id,'leader','active',now());
 END IF;
 RETURN result;
END;
$$;

CREATE FUNCTION public.create_creator_page_event_draft(p_page_id uuid,p_event_id uuid,p_title text,p_category text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_drafts; v_community uuid; v_existing public.explore_events;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 IF auth.uid() IS NULL OR p.id IS NULL OR (p.owner_id<>auth.uid() AND NOT (p.page_kind='community' AND public.is_community_leader(p.id,auth.uid())))
 OR NOT public.creator_page_audience_matches(coalesce(p.page_data->>'audience','everyone'),auth.uid()) THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 IF p_event_id IS NULL OR coalesce(btrim(p_title),'')='' OR length(p_title)>120 OR coalesce(btrim(p_category),'')='' THEN
  RAISE EXCEPTION 'A title and category are required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_existing FROM public.explore_events WHERE id=p_event_id;
 IF v_existing.id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.creator_page_events WHERE event_id=p_event_id AND page_id=p.id) AND v_existing.host_user_id=auth.uid() THEN RETURN p_event_id; END IF;
  RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501';
 END IF;
 IF p.page_kind='community' THEN v_community:=public.ensure_creator_page_community(p.id); END IF;
 INSERT INTO public.explore_events(id,title,category,status,host_user_id,community_id,public_name)
 VALUES(p_event_id,btrim(p_title),btrim(p_category),'Draft',auth.uid(),v_community,p.page_data->>'name');
 INSERT INTO public.creator_page_events(event_id,page_id) VALUES(p_event_id,p.id);
 RETURN p_event_id;
END;
$$;

CREATE FUNCTION public.creator_page_event_publication_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 IF NEW.status='Live' AND NOT EXISTS(SELECT 1 FROM public.creator_page_publications pub WHERE pub.page_id=v_page
   AND (pub.page_kind='organization' OR EXISTS(SELECT 1 FROM public.communities c WHERE c.id=v_page AND c.status='active'))) THEN
  RAISE EXCEPTION 'Publish the approved page before its event' USING ERRCODE='PT409'; END IF;
 IF NOT v_cleanup AND auth.uid() IS NOT NULL AND NOT public.creator_page_audience_matches(
  coalesce((SELECT audience FROM public.creator_page_publications WHERE page_id=v_page),p.page_data->>'audience','everyone'),auth.uid()) THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER creator_page_event_gate BEFORE INSERT OR UPDATE ON public.explore_events
 FOR EACH ROW EXECUTE FUNCTION public.creator_page_event_publication_guard();

CREATE FUNCTION public.publish_creator_page_event(p_page_id uuid,p_event_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_drafts; e public.explore_events;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 IF auth.uid() IS NULL OR p.id IS NULL OR (p.owner_id<>auth.uid() AND NOT (p.page_kind='community' AND public.is_community_leader(p.id,auth.uid()))) OR NOT public.creator_page_is_visible(p.id) THEN
  RAISE EXCEPTION 'Publish your approved page before its event' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.creator_page_events WHERE page_id=p.id AND event_id=p_event_id) THEN
  RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF e.status='Live' THEN RETURN e.id; END IF;
 IF e.status<>'Draft' THEN RAISE EXCEPTION 'This event cannot be published' USING ERRCODE='PT409'; END IF;
 -- Reuse full-field update + existing event-topic creation, keeping saved IDs,
 -- ticket settings, rich description and buyer confirmation unchanged.
 PERFORM public.operator_update_explore_event(p_event_id=>e.id,p_title=>e.title,p_description=>e.description,
  p_image_url=>e.image_url,p_event_date=>e.event_date::text,p_start_time=>e.start_time,p_end_time=>e.end_time,
  p_venue=>e.venue,p_venue_address=>e.venue_address,p_category=>e.category,p_external_url=>e.external_url,
  p_ticket_price=>e.ticket_price::text,p_public_name=>e.public_name,p_pin_to_chat=>e.pin_to_chat,p_status=>'Live',
  p_description_blocks=>e.description_blocks,p_confirmation_message=>e.confirmation_message);
 RETURN e.id;
END;
$$;

REVOKE ALL ON FUNCTION public.creator_page_validate_audience(),public.creator_page_event_publication_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.publish_creator_page(uuid,uuid),public.create_creator_page_event_draft(uuid,uuid,text,text),public.publish_creator_page_event(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.publish_creator_page(uuid,uuid),public.create_creator_page_event_draft(uuid,uuid,text,text),public.publish_creator_page_event(uuid,uuid) TO authenticated;

-- Additive restrictions only for the new bound pages/events. Legacy rows retain
-- their existing policies. Private event drafts remain visible to their creator.
CREATE POLICY creator_page_community_visibility ON public.communities AS RESTRICTIVE FOR SELECT
 USING(public.creator_community_is_visible(id) OR public.is_admin(auth.uid()));
CREATE POLICY creator_page_explore_visibility ON public.explore_events AS RESTRICTIVE FOR SELECT
 USING(public.creator_event_is_visible(id) OR public.creator_event_can_manage(id) OR public.is_admin(auth.uid()));
-- Further direct-table and security-definer route protections are appended by
-- the audited source transformation before this candidate is exercised.

CREATE FUNCTION public.creator_page_community_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='active' AND EXISTS(SELECT 1 FROM public.creator_page_drafts WHERE id=NEW.id)
 AND NOT EXISTS(SELECT 1 FROM public.creator_page_publications WHERE page_id=NEW.id) THEN
  RAISE EXCEPTION 'Publish the approved page first' USING ERRCODE='PT409'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER creator_page_community_status BEFORE INSERT OR UPDATE OF status ON public.communities
 FOR EACH ROW EXECUTE FUNCTION public.creator_page_community_status_guard();

CREATE FUNCTION public.creator_page_member_eligibility_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_audience text;
BEGIN
 SELECT audience INTO v_audience FROM public.creator_page_publications WHERE page_id=NEW.community_id;
 IF v_audience IS NOT NULL AND NEW.status IN ('pending','active')
 AND NOT public.creator_page_audience_matches(v_audience,NEW.user_id) THEN
  RAISE EXCEPTION 'Community unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER creator_page_member_eligibility BEFORE INSERT OR UPDATE ON public.community_members
 FOR EACH ROW EXECUTE FUNCTION public.creator_page_member_eligibility_guard();
REVOKE ALL ON FUNCTION public.creator_page_community_status_guard(),public.creator_page_member_eligibility_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.creator_topic_is_visible(p_topic_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT public.creator_community_is_visible(community_id) FROM public.community_topics WHERE id=p_topic_id),false);
$$;
REVOKE ALL ON FUNCTION public.creator_topic_is_visible(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_topic_is_visible(uuid) TO anon,authenticated,service_role;

-- Audited original-function and related-table changes follow.
-- Existing is_community_member: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."is_community_member"("p_community_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select (
    p_user_id = auth.uid()
    or is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)
    or auth.role() = 'service_role'
  )
  and public.creator_community_is_visible(p_community_id)
  and exists (
    select 1 from community_members
    where community_id = p_community_id and user_id = p_user_id and status = 'active'
  );
$$;

-- Existing is_community_leader: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."is_community_leader"("p_community_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select (
    p_user_id = auth.uid()
    or is_admin(auth.uid()) or has_role(auth.uid(), 'admin'::app_role)
    or auth.role() = 'service_role'
  )
  and public.creator_community_is_visible(p_community_id)
  and exists (
    select 1 from community_members
    where community_id = p_community_id and user_id = p_user_id
      and status = 'active' and role in ('leader', 'co_leader')
  );
$$;

-- Existing get_discoverable_communities: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."get_discoverable_communities"() RETURNS TABLE("id" "uuid", "handle" "text", "name" "text", "description" "text", "accent_color" "text", "cover_image" "text", "member_count" integer, "next_event_title" "text", "next_event_date" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    c.id, c.handle, c.name, c.description, c.accent_color,
    (SELECT b.content->'images'->>0
     FROM community_blocks b
     WHERE b.community_id = c.id AND b.block_type = 'cover' AND b.visible
     ORDER BY b.position LIMIT 1) AS cover_image,
    (SELECT count(*)::integer FROM community_members m
     WHERE m.community_id = c.id AND m.status = 'active') AS member_count,
    ne.title AS next_event_title,
    ne.event_date AS next_event_date
  FROM communities c
  LEFT JOIN LATERAL (
    SELECT e.title, e.event_date
    FROM explore_events e
    WHERE e.community_id = c.id AND e.status = 'Live'
      AND coalesce(e.event_date, current_date) >= current_date
    ORDER BY e.event_date ASC NULLS LAST
    LIMIT 1
  ) ne ON true
  WHERE c.status = 'active' AND public.creator_community_is_visible(c.id)
    AND c.discoverable
  ORDER BY member_count DESC, c.created_at ASC
  LIMIT 100;
$$;

-- Existing get_community_member_count: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."get_community_member_count"("p_community_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when exists (select 1 from communities c
                 where c.id = p_community_id and c.status = 'active' AND public.creator_community_is_visible(c.id))
    then (select count(*)::integer from community_members m
          where m.community_id = p_community_id and m.status = 'active')
    else null
  end;
$$;

-- Existing get_community_leader_cards: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."get_community_leader_cards"("p_community_ids" "uuid"[]) RETURNS TABLE("community_id" "uuid", "display_name" "text", "avatar_url" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select distinct on (m.community_id)
    m.community_id,
    p.first_name_display as display_name,
    p.profile_photo_url as avatar_url
  from community_members m
  join communities c on c.id = m.community_id and c.status = 'active' AND public.creator_community_is_visible(c.id)
  join profiles_public p on p.id = m.user_id
  where m.community_id = any (p_community_ids)
    and m.role = 'leader'
    and m.status = 'active'
  order by m.community_id, m.joined_at asc nulls last;
$$;

-- Existing get_my_community_chat_cards: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."get_my_community_chat_cards"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'cards',
    coalesce((
      select jsonb_agg(card order by (card->>'last_activity_at') desc nulls last)
      from (
        select jsonb_build_object(
          'community_id', c.id,
          'handle', c.handle,
          'name', c.name,
          'accent_color', c.accent_color,
          'role', m.role,
          'latest_broadcast', lb.broadcast,
          'unread_broadcasts', coalesce(ub.n, 0),
          'topics', coalesce(tp.topics, '[]'::jsonb),
          'unread_total', coalesce(ub.n, 0) + coalesce(tp.unread_topics_total, 0),
          'last_activity_at', greatest(lb.latest_at, tp.latest_message_at)
        ) as card
        from community_members m
        join communities c on c.id = m.community_id and c.status = 'active' AND public.creator_community_is_visible(c.id)
        left join lateral (
          select jsonb_build_object(
                   'id', b.id, 'body', b.body, 'created_at', b.created_at,
                   'sender_id', b.sender_id
                 ) as broadcast,
                 b.created_at as latest_at
          from community_broadcasts b
          where b.community_id = c.id
          order by b.created_at desc
          limit 1
        ) lb on true
        left join lateral (
          select count(*)::integer as n
          from community_broadcasts b
          where b.community_id = c.id
            and b.sender_id is distinct from auth.uid()
            and b.created_at > coalesce(
              (select r.last_read_at from community_broadcast_reads r
               where r.community_id = c.id and r.user_id = auth.uid()),
              m.joined_at, m.created_at)
        ) ub on true
        left join lateral (
          select jsonb_agg(jsonb_build_object(
                   'id', t.id,
                   'name', t.name,
                   'is_default', t.is_default,
                   'explore_event_id', t.explore_event_id,
                   'joined', (tm.user_id is not null),
                   'notifications_on', coalesce(tm.notifications_on, false),
                   'unread', coalesce(tu.n, 0),
                   'last_message_at', lm.latest_at
                 ) order by t.is_default desc, lm.latest_at desc nulls last) as topics,
                 sum(coalesce(tu.n, 0))::integer as unread_topics_total,
                 max(lm.latest_at) filter (where tm.user_id is not null) as latest_message_at
          from community_topics t
          left join community_topic_members tm
            on tm.topic_id = t.id and tm.user_id = auth.uid()
          left join lateral (
            select max(msg.created_at) as latest_at
            from community_topic_messages msg where msg.topic_id = t.id
          ) lm on true
          left join lateral (
            select count(*)::integer as n
            from community_topic_messages msg
            where msg.topic_id = t.id
              and tm.user_id is not null
              and msg.sender_id is distinct from auth.uid()
              and msg.created_at > coalesce(
                (select r.last_read_at from community_topic_reads r
                 where r.topic_id = t.id and r.user_id = auth.uid()),
                tm.joined_at)
          ) tu on true
          where t.community_id = c.id and not t.archived
        ) tp on true
        where m.user_id = auth.uid() and m.status = 'active'
      ) cards
    ), '[]'::jsonb),
    'attendee_topics',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'community_id', c.id,
               'community_name', c.name,
               'accent_color', c.accent_color,
               'explore_event_id', t.explore_event_id,
               'notifications_on', tm.notifications_on,
               'unread', coalesce((
                 select count(*)::integer
                 from community_topic_messages msg
                 where msg.topic_id = t.id
                   and msg.sender_id is distinct from auth.uid()
                   and msg.created_at > coalesce(
                     (select r.last_read_at from community_topic_reads r
                      where r.topic_id = t.id and r.user_id = auth.uid()),
                     tm.joined_at)
               ), 0),
               'last_message_at', (
                 select max(msg.created_at)
                 from community_topic_messages msg where msg.topic_id = t.id
               ),
               'joined_at', tm.joined_at
             ) order by tm.joined_at desc)
      from community_topic_members tm
      join community_topics t on t.id = tm.topic_id
      join communities c on c.id = t.community_id
      where tm.user_id = auth.uid() AND public.creator_community_is_visible(c.id)
        and t.explore_event_id is not null
        and not t.archived
        and not exists (
          select 1 from community_members m
          where m.community_id = t.community_id
            and m.user_id = auth.uid() and m.status = 'active'
        )
    ), '[]'::jsonb)
  );
$$;

-- Existing get_event_rsvp_count: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."get_event_rsvp_count"("p_event_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when exists (select 1 from explore_events e where e.id = p_event_id and e.status = 'Live' AND public.creator_event_is_visible(e.id))
    then (select count(*)::integer from explore_event_rsvps r
          where r.explore_event_id = p_event_id and r.status = 'going')
    else null
  end;
$$;

-- Existing get_event_social_proof: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."get_event_social_proof"("p_event_id" "uuid") RETURNS TABLE("user_id" "uuid", "first_name_display" "text", "profile_photo_url" "text", "is_mutual" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := (select auth.uid());
  -- the display cap: at most this many identities ever leave the definer
  v_cap constant integer := 12;
begin
  if v_uid is null OR NOT public.creator_event_is_visible(p_event_id) then
    return;
  end if;
  if not exists (
    select 1 from public.explore_events e
    where e.id = p_event_id and e.social_proof_visible
  ) then
    return;
  end if;
  return query
  select s.rsvp_user_id, s.name_display, s.photo_url, s.mutual
  from (
    select r.user_id as rsvp_user_id,
           p.first_name_display as name_display,
           p.profile_photo_url as photo_url,
           exists (
             select 1 from public.people_connections pc
             where pc.status = 'accepted'
               and ((pc.requester_user_id = v_uid and pc.recipient_user_id = r.user_id)
                 or (pc.recipient_user_id = v_uid and pc.requester_user_id = r.user_id))
           ) as mutual,
           r.created_at as rsvped_at
    from public.explore_event_rsvps r
    join public.profiles p on p.id = r.user_id
    where r.explore_event_id = p_event_id
      and r.status = 'going'
      and r.user_id <> v_uid
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = v_uid and b.blocked_id = r.user_id)
           or (b.blocker_id = r.user_id and b.blocked_id = v_uid)
      )
  ) s
  order by s.mutual desc, s.rsvped_at asc
  limit v_cap;
end;
$$;

-- Existing request_to_join_community: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."request_to_join_community"("p_community_id" "uuid", "p_answers" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_uid uuid := auth.uid();
  v_community record;
  v_existing record;
  v_member_id uuid;
  v_first text;
  v_stored jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select id, name, status, join_ask_reason, join_ask_source, join_ask_rules_confirm, join_open_question
  into v_community
  from communities where id = p_community_id AND public.creator_community_is_visible(id);
  if v_community.id is null or v_community.status <> 'active' then
    raise exception 'That community is not open to joins right now.';
  end if;

  -- every field required, validated server-side (the popup mirrors this)
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers are required.';
  end if;
  if coalesce(btrim(p_answers->>'first_name'), '') = ''
     or char_length(p_answers->>'first_name') > 100 then
    raise exception 'First name is required.';
  end if;
  if coalesce(btrim(p_answers->>'last_name'), '') = ''
     or char_length(p_answers->>'last_name') > 100 then
    raise exception 'Last name is required.';
  end if;
  if coalesce(btrim(p_answers->>'email'), '') = ''
     or p_answers->>'email' !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or char_length(p_answers->>'email') > 254 then
    raise exception 'A real email is required.';
  end if;
  if coalesce(btrim(p_answers->>'zip'), '') = ''
     or p_answers->>'zip' !~ '^[0-9]{5}$' then
    raise exception 'A 5 digit zip code is required.';
  end if;
  if coalesce(btrim(p_answers->>'intro_answer'), '') = ''
     or char_length(p_answers->>'intro_answer') > 1000 then
    raise exception 'Your introduction is required.';
  end if;
  if coalesce((p_answers->>'guidelines_accepted')::boolean, false) is not true then
    raise exception 'Accepting the community guidelines is required.';
  end if;

  -- Liz decision #11: each of these only applies -- and is only required --
  -- when THIS community has that slot turned on.
  if v_community.join_ask_reason and (
       coalesce(btrim(p_answers->>'reason_answer'), '') = ''
       or char_length(p_answers->>'reason_answer') > 1000
     ) then
    raise exception 'Tell us why you want to join.';
  end if;
  if v_community.join_ask_source and (
       coalesce(btrim(p_answers->>'source_answer'), '') = ''
       or char_length(p_answers->>'source_answer') > 500
     ) then
    raise exception 'Tell us how you heard about this community.';
  end if;
  if v_community.join_ask_rules_confirm
     and coalesce((p_answers->>'rules_confirmed')::boolean, false) is not true then
    raise exception 'Confirming you meet the membership requirement is required.';
  end if;
  if coalesce(btrim(v_community.join_open_question), '') <> '' and (
       coalesce(btrim(p_answers->>'open_answer'), '') = ''
       or char_length(p_answers->>'open_answer') > 1000
     ) then
    raise exception 'That answer is required.';
  end if;

  -- whitelist: store exactly the doc 09 keys, nothing else, plus whichever
  -- of the four new keys this community actually asks for
  v_stored := jsonb_build_object(
    'first_name', btrim(p_answers->>'first_name'),
    'last_name', btrim(p_answers->>'last_name'),
    'email', btrim(p_answers->>'email'),
    'zip', btrim(p_answers->>'zip'),
    'intro_answer', btrim(p_answers->>'intro_answer'),
    'guidelines_accepted_at', now()
  );
  if v_community.join_ask_reason then
    v_stored := v_stored || jsonb_build_object('reason_answer', btrim(p_answers->>'reason_answer'));
  end if;
  if v_community.join_ask_source then
    v_stored := v_stored || jsonb_build_object('source_answer', btrim(p_answers->>'source_answer'));
  end if;
  if v_community.join_ask_rules_confirm then
    v_stored := v_stored || jsonb_build_object('rules_confirmed', true);
  end if;
  if coalesce(btrim(v_community.join_open_question), '') <> '' then
    v_stored := v_stored || jsonb_build_object('open_answer', btrim(p_answers->>'open_answer'));
  end if;

  select id, status into v_existing
  from community_members
  where community_id = p_community_id and user_id = v_uid;

  if v_existing.id is null then
    insert into community_members (community_id, user_id, role, status)
    values (p_community_id, v_uid, 'member', 'pending')
    returning id into v_member_id;
  elsif v_existing.status = 'left' then
    -- rejoining after leaving on good terms: same row back to pending
    update community_members
    set status = 'pending', joined_at = null
    where id = v_existing.id;
    v_member_id := v_existing.id;
  elsif v_existing.status = 'pending' then
    raise exception 'You already asked to join. The leader has your request.';
  elsif v_existing.status = 'active' then
    raise exception 'You are already a member.';
  else
    -- declined, removed, or banned: rejoin-after-decline is a logged open
    -- question, now revisitable thanks to the distinct 'declined' status
    raise exception 'You cannot join this community right now.';
  end if;

  -- answers land ONLY in the private table (leader-eyes-only by RLS)
  insert into community_member_answers (member_id, community_id, user_id, answers)
  values (v_member_id, p_community_id, v_uid, v_stored)
  on conflict (member_id)
  do update set answers = excluded.answers, updated_at = now();

  -- tell every active leader and co-leader (LIZ COPY)
  v_first := v_stored->>'first_name';
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  select m.user_id,
         'community_join_request',
         'someone wants in',
         v_first || ' asked to join ' || v_community.name || '. their introduction is waiting for you.',
         v_uid
  from community_members m
  where m.community_id = p_community_id
    and m.role in ('leader', 'co_leader')
    and m.status = 'active';
end;
$_$;

-- Existing get_ticket_tier_availability: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."get_ticket_tier_availability"("p_tier_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tier record;
  v_capacity integer;
  v_tier_used integer;
  v_event_used integer;
  v_tier_remaining integer;
  v_event_remaining integer;
begin
  select t.id, t.event_id, t.quantity_cap into v_tier
  from public.ticket_tiers t where t.id = p_tier_id;
  if not found OR (NOT public.creator_event_is_visible(v_tier.event_id) AND NOT public.creator_event_can_manage(v_tier.event_id)) then
    return null;
  end if;
  select e.ticket_capacity into v_capacity
  from public.explore_events e where e.id = v_tier.event_id;

  if v_tier.quantity_cap is null and v_capacity is null then
    return null;  -- uncapped at both levels
  end if;

  if v_tier.quantity_cap is not null then
    select coalesce((
        select count(*) from public.ticket_order_positions p
        join public.ticket_orders o on o.id = p.order_id
        where o.tier_id = p_tier_id and o.status in ('paid', 'refunded')
          and p.voided_at is null), 0)
      + coalesce((
        select sum(h.qty) from public.ticket_holds h
        where h.tier_id = p_tier_id and h.status = 'active'
          and h.expires_at > now()), 0)
      into v_tier_used;
    v_tier_remaining := greatest(v_tier.quantity_cap - v_tier_used, 0);
  end if;

  if v_capacity is not null then
    select coalesce((
        select count(*) from public.ticket_order_positions p
        join public.ticket_orders o on o.id = p.order_id
        where o.event_id = v_tier.event_id and o.status in ('paid', 'refunded')
          and p.voided_at is null), 0)
      + coalesce((
        select sum(h.qty) from public.ticket_holds h
        where h.event_id = v_tier.event_id and h.status = 'active'
          and h.expires_at > now()), 0)
      into v_event_used;
    v_event_remaining := greatest(v_capacity - v_event_used, 0);
  end if;

  return least(coalesce(v_tier_remaining, 2147483647),
               coalesce(v_event_remaining, 2147483647));
end;
$$;

-- Existing quote_ticket_checkout: retain the body except the recorded new-page guard.
CREATE OR REPLACE FUNCTION "public"."quote_ticket_checkout"("p_tier_id" "uuid", "p_qty" integer, "p_promo_code" "text" DEFAULT NULL::"text", "p_add_ons" "jsonb" DEFAULT NULL::"jsonb") RETURNS TABLE("ok" boolean, "reason" "text", "unit_face_cents" integer, "face_cents" integer, "discount_cents" integer, "processing_cents" integer, "total_cents" integer, "addon_total_cents" integer, "is_free" boolean, "promo_valid" boolean, "promo_reason" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tier record; v_event record; v_promo record;
  v_promo_type text := null; v_promo_value integer := null;
  v_promo_valid boolean := false; v_promo_reason text := null;
  v_payee_user uuid; v_acct record; v_p record;
  v_item jsonb; v_ao record; v_ao_id uuid; v_ao_qty int;
  v_addon_total integer := 0; v_seen jsonb := '[]'::jsonb;
begin
  if p_qty is null or p_qty < 1 or p_qty > 50 then
    return query select false, 'pick a quantity between 1 and 50.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  select t.id, t.event_id, t.price_cents, t.status, t.visibility, t.sales_open_at, t.sales_close_at, t.per_order_min, t.per_order_max
    into v_tier from public.ticket_tiers t where t.id = p_tier_id;
  if v_tier.id is null OR NOT public.creator_event_is_visible(v_tier.event_id) then
    return query select false, 'that ticket is not available.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  select e.id, e.status, e.host_user_id, e.community_id, e.end_time into v_event
    from public.explore_events e where e.id = v_tier.event_id;
  if v_event.status <> 'Live' then
    return query select false, 'this event is not selling tickets right now.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if v_event.end_time is not null and v_event.end_time < now() then
    return query select false, 'this event has already ended.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if v_tier.status <> 'on_sale' or v_tier.visibility = 'hidden' then
    return query select false, 'that ticket is not on sale.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if (v_tier.sales_open_at is not null or v_tier.sales_close_at is not null)
     and not (now() >= coalesce(v_tier.sales_open_at, '-infinity'::timestamptz)
              and now() <= coalesce(v_tier.sales_close_at, 'infinity'::timestamptz)) then
    return query select false, 'that ticket is not on sale right now.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if p_qty < v_tier.per_order_min then
    return query select false, format('this ticket needs at least %s per order.', v_tier.per_order_min)::text,
      0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if v_tier.per_order_max is not null and p_qty > v_tier.per_order_max then
    return query select false, format('this ticket allows at most %s per order.', v_tier.per_order_max)::text,
      0,0,0,0,0,0, false, false, null::text;
    return; end if;
  if public.get_ticket_tier_availability(p_tier_id) < p_qty then
    return query select false, 'there are not enough left.'::text, 0,0,0,0,0,0, false, false, null::text;
    return; end if;

  if p_add_ons is not null then
    if jsonb_typeof(p_add_ons) <> 'array' or jsonb_array_length(p_add_ons) = 0 or jsonb_array_length(p_add_ons) > 20 then
      return query select false, 'that add-on list is not valid.'::text, 0,0,0,0,0,0, false, false, null::text;
      return; end if;
    for v_item in select * from jsonb_array_elements(p_add_ons) loop
      if jsonb_typeof(v_item->'qty') <> 'number' then
        return query select false, 'each add-on needs a quantity.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      v_ao_qty := (v_item->>'qty')::int;
      begin v_ao_id := (v_item->>'add_on_id')::uuid;
      exception when others then
        return query select false, 'each add-on needs its id.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end;
      if v_ao_qty is null or v_ao_qty < 1 or v_ao_qty > 50 then
        return query select false, 'that add-on quantity is not valid.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      if v_seen @> jsonb_build_array(jsonb_build_object('id', v_ao_id)) then
        return query select false, 'that add-on is listed twice.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      select a.id, a.price_cents, a.quantity_cap, a.per_order_max, a.sales_open_at, a.sales_close_at, a.sold_count, a.status
        into v_ao from public.event_add_ons a where a.id = v_ao_id and a.event_id = v_event.id;
      if v_ao.id is null or v_ao.status <> 'on_sale' then
        return query select false, 'that add-on is not available.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      if (v_ao.sales_open_at is not null and now() < v_ao.sales_open_at)
         or (v_ao.sales_close_at is not null and now() > v_ao.sales_close_at) then
        return query select false, 'that add-on is not available right now.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      if v_ao.per_order_max is not null and v_ao_qty > v_ao.per_order_max then
        return query select false, format('that add-on allows at most %s per order.', v_ao.per_order_max)::text,
          0,0,0,0,0,0, false, false, null::text;
        return; end if;
      if v_ao.quantity_cap is not null and v_ao.sold_count + v_ao_qty > v_ao.quantity_cap then
        return query select false, 'that add-on just sold out.'::text, 0,0,0,0,0,0, false, false, null::text;
        return; end if;
      v_addon_total := v_addon_total + v_ao.price_cents * v_ao_qty;
      v_seen := v_seen || jsonb_build_object('id', v_ao_id);
    end loop;
  end if;

  if p_promo_code is not null and btrim(p_promo_code) <> '' then
    select pc.id, pc.discount_type, pc.discount_value, pc.max_uses, pc.uses_count, pc.starts_at, pc.ends_at, pc.active
      into v_promo from public.ticket_promo_codes pc
      where pc.event_id = v_event.id and lower(pc.code) = lower(btrim(p_promo_code));
    if v_promo.id is null or not v_promo.active then
      v_promo_reason := 'that code did not match anything for this event.';
    elsif v_promo.starts_at is not null and now() < v_promo.starts_at then
      v_promo_reason := 'that code is not live yet.';
    elsif v_promo.ends_at is not null and now() > v_promo.ends_at then
      v_promo_reason := 'that code has expired.';
    elsif v_promo.max_uses is not null and v_promo.uses_count >= v_promo.max_uses then
      v_promo_reason := 'that code has been used up.';
    elsif v_promo.discount_type is null then
      v_promo_reason := 'that code does not change the price.';
    elsif not public.promo_applies_to_tier(v_promo.id, p_tier_id) then
      v_promo_reason := 'that code does not work on this ticket.';
    else
      v_promo_valid := true; v_promo_type := v_promo.discount_type; v_promo_value := v_promo.discount_value;
    end if;
  end if;

  v_payee_user := v_event.host_user_id;
  if v_payee_user is null and v_event.community_id is not null then
    select c.created_by into v_payee_user from public.communities c where c.id = v_event.community_id; end if;
  select a.stripe_account_id, a.charges_enabled into v_acct
    from public.organizer_stripe_accounts a where a.user_id = v_payee_user;

  select * into v_p from public.price_ticket_checkout(v_tier.price_cents, p_qty, v_promo_type, v_promo_value, v_addon_total);

  if not v_p.is_free and (v_payee_user is null or v_acct.stripe_account_id is null
       or not coalesce(v_acct.charges_enabled, false)) then
    return query select false, 'this event cannot take payments yet.'::text, 0,0,0,0,0,0, false, v_promo_valid, v_promo_reason;
    return; end if;

  return query select true, null::text, v_p.unit_face_cents, v_p.face_cents, v_p.discount_cents,
    v_p.processing_cents, v_p.total_cents, v_addon_total, v_p.is_free, v_promo_valid, v_promo_reason;
end;
$$;

CREATE POLICY creator_bound_page_visibility ON public.community_blocks AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.community_broadcast_reads AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.community_broadcasts AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.community_creator_invites AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.community_member_answers AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.community_member_invites AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.community_members AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.community_topics AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.follower_broadcasts AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_page_visibility ON public.organizer_follows AS RESTRICTIVE FOR SELECT USING(public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_event_visibility ON public.event_add_ons AS RESTRICTIVE FOR SELECT USING(event_id IS NULL OR public.creator_event_is_visible(event_id) OR public.creator_event_can_manage(event_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_event_visibility ON public.event_faqs AS RESTRICTIVE FOR SELECT USING(event_id IS NULL OR public.creator_event_is_visible(event_id) OR public.creator_event_can_manage(event_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_event_visibility ON public.events AS RESTRICTIVE FOR SELECT USING(explore_event_id IS NULL OR public.creator_event_is_visible(explore_event_id) OR public.creator_event_can_manage(explore_event_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_event_visibility ON public.explore_event_rsvps AS RESTRICTIVE FOR SELECT USING(explore_event_id IS NULL OR public.creator_event_is_visible(explore_event_id) OR public.creator_event_can_manage(explore_event_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_event_visibility ON public.explore_wishlists AS RESTRICTIVE FOR SELECT USING(explore_event_id IS NULL OR public.creator_event_is_visible(explore_event_id) OR public.creator_event_can_manage(explore_event_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_event_visibility ON public.ticket_promo_codes AS RESTRICTIVE FOR SELECT USING(event_id IS NULL OR public.creator_event_is_visible(event_id) OR public.creator_event_can_manage(event_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_event_visibility ON public.ticket_questions AS RESTRICTIVE FOR SELECT USING(event_id IS NULL OR public.creator_event_is_visible(event_id) OR public.creator_event_can_manage(event_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_event_visibility ON public.ticket_tiers AS RESTRICTIVE FOR SELECT USING(event_id IS NULL OR public.creator_event_is_visible(event_id) OR public.creator_event_can_manage(event_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_topic_visibility ON public.community_topic_members AS RESTRICTIVE FOR SELECT USING(public.creator_topic_is_visible(topic_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_topic_visibility ON public.community_topic_messages AS RESTRICTIVE FOR SELECT USING(public.creator_topic_is_visible(topic_id) OR public.is_admin(auth.uid()));

CREATE POLICY creator_bound_topic_visibility ON public.community_topic_reads AS RESTRICTIVE FOR SELECT USING(public.creator_topic_is_visible(topic_id) OR public.is_admin(auth.uid()));

COMMIT;
