-- LOCAL / REVIEW ONLY. Exact-page event content delegation. No legacy backfill.
-- Existing financial predicates/providers continue to identify the page owner.
-- A private creation receipt records the initiating teammate without assigning
-- that account to the event ownership columns. Existing events are never moved.
BEGIN;

DO $$ BEGIN IF md5(pg_get_functiondef('create_creator_page_event_draft(uuid,uuid,text,text)'::regprocedure))<>'e5d686a1bff5733793d0ca5a37ab61cf' THEN RAISE EXCEPTION 'Reconcile current create_creator_page_event_draft before applying page event delegation'; END IF; END $$;

DO $$ BEGIN IF md5(pg_get_functiondef('creator_event_can_manage(uuid)'::regprocedure))<>'693eed01576fb556e6ebfd64ef122b75' THEN RAISE EXCEPTION 'Reconcile current creator_event_can_manage before applying page event delegation'; END IF; END $$;

DO $$ BEGIN IF md5(pg_get_functiondef('operator_update_explore_event(uuid,text,text,text,text,timestamp with time zone,text,text,text,text,text,text,boolean,text,timestamp with time zone,jsonb,text)'::regprocedure))<>'75e4582cd1a46cd1a403b6e0423f838f' THEN RAISE EXCEPTION 'Reconcile current operator_update_explore_event before applying page event delegation'; END IF; END $$;

DO $$ BEGIN IF md5(pg_get_functiondef('operator_set_explore_event_coords(uuid,double precision,double precision)'::regprocedure))<>'d35faccd2493de6f3e305a2474bf62be' THEN RAISE EXCEPTION 'Reconcile current operator_set_explore_event_coords before applying page event delegation'; END IF; END $$;

DO $$ BEGIN IF md5(pg_get_functiondef('publish_creator_page_event(uuid,uuid)'::regprocedure))<>'5f4708f60a843535212b524ca6b8305c' THEN RAISE EXCEPTION 'Reconcile current publish_creator_page_event before applying page event delegation'; END IF; END $$;

CREATE TABLE public.creator_page_team_event_creations (
 event_id uuid PRIMARY KEY,
 page_id uuid NOT NULL,
 initiated_by uuid NOT NULL,
 page_owner_id uuid NOT NULL,
 requested_title text NOT NULL,
 requested_category text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(initiated_by<>page_owner_id)
);
-- Durable receipt intentionally survives account/page/event deletion; retrying
-- an old ID must never resurrect a deleted event or change its attribution.
ALTER TABLE public.creator_page_team_event_creations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_team_event_creations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.creator_page_team_event_can_manage(p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.creator_page_events l JOIN public.explore_events e ON e.id=l.event_id
  WHERE l.event_id=p_event_id AND public.creator_page_team_can_manage(l.page_id,'page_events')
 );
$$;
REVOKE ALL ON FUNCTION public.creator_page_team_event_can_manage(uuid) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.create_creator_page_event_draft(p_page_id uuid, p_event_id uuid, p_title text, p_category text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.creator_page_drafts; v_community uuid; v_existing public.explore_events; v_delegated boolean; v_receipt public.creator_page_team_event_creations;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 IF auth.uid() IS NULL OR p.id IS NULL OR (p.owner_id<>auth.uid() AND NOT (p.page_kind='community' AND public.is_community_leader(p.id,auth.uid())) AND NOT public.creator_page_team_can_manage(p.id,'page_events'))
 OR NOT public.creator_page_audience_matches(coalesce(p.page_data->>'audience','everyone'),auth.uid()) THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 IF p_event_id IS NULL OR coalesce(btrim(p_title),'')='' OR length(p_title)>120 OR coalesce(btrim(p_category),'')='' THEN
  RAISE EXCEPTION 'A title and category are required' USING ERRCODE='22023'; END IF;
 v_delegated := p.owner_id<>auth.uid() AND NOT (p.page_kind='community' AND public.is_community_leader(p.id,auth.uid()));
 SELECT * INTO v_receipt FROM public.creator_page_team_event_creations WHERE event_id=p_event_id;
 IF v_delegated THEN
  IF v_receipt.event_id IS NOT NULL AND (v_receipt.page_id<>p.id OR v_receipt.initiated_by<>auth.uid()
    OR v_receipt.page_owner_id<>p.owner_id OR v_receipt.requested_title<>btrim(p_title)
    OR v_receipt.requested_category<>btrim(p_category)) THEN
   RAISE EXCEPTION 'This saved event attempt does not match' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT * INTO v_existing FROM public.explore_events WHERE id=p_event_id;
 IF v_delegated AND v_receipt.event_id IS NOT NULL THEN
  IF v_existing.id IS NOT NULL AND v_existing.host_user_id=p.owner_id
   AND EXISTS(SELECT 1 FROM public.creator_page_events WHERE event_id=p_event_id AND page_id=p.id) THEN RETURN p_event_id; END IF;
  RAISE EXCEPTION 'The original event is unavailable' USING ERRCODE='42501';
 END IF;
 IF v_existing.id IS NULL AND v_receipt.event_id IS NOT NULL THEN
  RAISE EXCEPTION 'The original event is unavailable' USING ERRCODE='42501'; END IF;
 IF v_existing.id IS NOT NULL THEN
  IF v_delegated THEN RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.creator_page_events WHERE event_id=p_event_id AND page_id=p.id) AND v_existing.host_user_id=auth.uid() THEN RETURN p_event_id; END IF;
  RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501';
 END IF;
 IF p.page_kind='community' THEN v_community:=public.ensure_creator_page_community(p.id); END IF;
 INSERT INTO public.explore_events(id,title,category,status,host_user_id,community_id,public_name)
 VALUES(p_event_id,btrim(p_title),btrim(p_category),'Draft',CASE WHEN v_delegated THEN p.owner_id ELSE auth.uid() END,v_community,p.page_data->>'name');
 INSERT INTO public.creator_page_events(event_id,page_id) VALUES(p_event_id,p.id);
 IF v_delegated THEN
  INSERT INTO public.creator_page_team_event_creations(event_id,page_id,initiated_by,page_owner_id,requested_title,requested_category)
   VALUES(p_event_id,p.id,auth.uid(),p.owner_id,btrim(p_title),btrim(p_category));
 END IF;
 RETURN p_event_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.creator_event_can_manage(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.explore_events e WHERE e.id=p_event_id
 AND public.creator_event_owner_is_eligible(e.id)
 AND (e.host_user_id=auth.uid() OR public.is_community_leader(e.community_id,auth.uid()) OR public.creator_page_team_event_can_manage(e.id)));
$function$;


CREATE OR REPLACE FUNCTION public.operator_update_explore_event(p_event_id uuid, p_title text, p_description text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_event_date text DEFAULT NULL::text, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_venue text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_external_url text DEFAULT NULL::text, p_ticket_price text DEFAULT NULL::text, p_public_name text DEFAULT NULL::text, p_pin_to_chat boolean DEFAULT true, p_status text DEFAULT NULL::text, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description_blocks jsonb DEFAULT NULL::jsonb, p_confirmation_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, host_user_id, community_id, status into v_row
  from explore_events where id = p_event_id;
  if v_row.id is null then
    raise exception 'Event not found';
  end if;
  if not (v_row.host_user_id = v_uid
          or (v_row.community_id is not null and is_community_leader(v_row.community_id, v_uid))
          or public.creator_page_team_event_can_manage(p_event_id)) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' or char_length(p_title) > 120 then
    raise exception 'A title is required.';
  end if;
  if p_status is not null and p_status not in ('Live', 'Completed', 'Cancelled') then
    raise exception 'Invalid status';
  end if;
  if v_row.status = 'Draft' and p_status in ('Completed', 'Cancelled') then
    -- LIZ COPY
    raise exception 'This one is still a draft. Publish it or keep shaping it.';
  end if;
  if coalesce(btrim(p_category), '') = '' then
    raise exception 'Pick a category.';
  end if;
  -- S5: Live (asked for or carried through the full overwrite) keeps a date;
  -- this also blocks blanking the date on a Live event. Cancel/complete of a
  -- dateless legacy row stays allowed. (LIZ COPY guard)
  if coalesce(p_status, v_row.status) = 'Live'
     and coalesce(btrim(p_event_date), '') = '' then
    raise exception 'Pick a date.';
  end if;
  -- 75: when both times exist, order them (client-surfaced guard)
  if p_end_time is not null and p_start_time is not null
     and p_end_time <= p_start_time then
    raise exception 'The end has to come after the start.';
  end if;
  -- SQL-96: the friendly cap, ahead of the CHECK (LIZ COPY)
  if p_confirmation_message is not null and char_length(p_confirmation_message) > 2500 then
    raise exception 'Keep the confirmation note under 2500 characters.';
  end if;

  update explore_events set
    title = btrim(p_title),
    description = nullif(btrim(p_description), ''),
    image_url = nullif(btrim(p_image_url), ''),
    event_date = nullif(btrim(p_event_date), '')::date,
    start_time = p_start_time,
    end_time = p_end_time,
    venue = nullif(btrim(p_venue), ''),
    venue_address = nullif(btrim(p_venue_address), ''),
    category = nullif(btrim(p_category), ''),
    external_url = nullif(btrim(p_external_url), ''),
    ticket_price = nullif(btrim(p_ticket_price), '')::numeric,
    public_name = nullif(btrim(p_public_name), ''),
    pin_to_chat = coalesce(p_pin_to_chat, true),
    status = coalesce(p_status, status),
    -- 77's DOCUMENTED DEVIATION from full-overwrite: null = leave the rich
    -- body untouched (it is large and easy to lose); [] = clear it
    description_blocks = coalesce(p_description_blocks, description_blocks),
    -- SQL-96, same deviation on purpose: null = keep, '' = clear
    confirmation_message = case
      when p_confirmation_message is null then confirmation_message
      else nullif(btrim(p_confirmation_message), '')
    end,
    updated_at = now()
  where id = p_event_id;

  -- publish flip: the event chat is born NOW; the partial unique index
  -- (one topic per event) makes a double-publish a clean no-op
  if v_row.status = 'Draft' and p_status = 'Live' and v_row.community_id is not null then
    insert into community_topics (community_id, name, created_by, explore_event_id)
    values (v_row.community_id, left(btrim(p_title), 60), v_uid, p_event_id)
    on conflict (explore_event_id) where explore_event_id is not null do nothing;
  end if;

  update community_topics
  set name = left(btrim(p_title), 60),
      archived = archived or coalesce(p_status, '') in ('Cancelled', 'Completed')
  where explore_event_id = p_event_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.operator_set_explore_event_coords(p_event_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, host_user_id, community_id into v_row
  from explore_events where id = p_event_id;
  if v_row.id is null then
    raise exception 'Event not found';
  end if;
  if not (v_row.host_user_id = v_uid
          or (v_row.community_id is not null and is_community_leader(v_row.community_id, v_uid))
          or public.creator_page_team_event_can_manage(p_event_id)) then
    raise exception 'Not authorized';
  end if;
  -- both or neither: a lone latitude is never a place
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Coordinates travel as a pair';
  end if;

  update explore_events set
    latitude = p_latitude,
    longitude = p_longitude,
    updated_at = now()
  where id = p_event_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.publish_creator_page_event(p_page_id uuid, p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.creator_page_drafts; e public.explore_events;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 IF auth.uid() IS NULL OR p.id IS NULL OR (p.owner_id<>auth.uid() AND NOT (p.page_kind='community' AND public.is_community_leader(p.id,auth.uid())) AND NOT public.creator_page_team_can_manage(p.id,'page_events')) OR NOT public.creator_page_is_visible(p.id) THEN
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
$function$;


-- Adds content reads for an eligible exact-page teammate. Financial tables
-- keep their existing permissive and restrictive policies without changes.
CREATE POLICY creator_page_team_event_read ON public.explore_events FOR SELECT TO authenticated
 USING(public.creator_event_can_manage(id));
CREATE FUNCTION public.get_creator_page_team_workspace(p_page_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.creator_page_publications;
BEGIN
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=p_page_id;
 IF p.page_id IS NULL OR NOT public.creator_page_team_can_manage(p_page_id,'page_events') THEN
  RAISE EXCEPTION 'Page unavailable' USING ERRCODE='42501'; END IF;
 -- Explicit published-content projection; no draft applications, submissions,
 -- private review evidence, financial fields or unrelated-page records.
 RETURN jsonb_build_object('page_id',p.page_id,'page_kind',p.page_kind,'page_name',p.name,'owner_id',p.owner_id,
  'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'category',e.category,'status',e.status)
   ORDER BY e.created_at DESC,e.id),'[]'::jsonb) FROM public.creator_page_events l
   JOIN public.explore_events e ON e.id=l.event_id WHERE l.page_id=p_page_id));
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_team_workspace(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_team_workspace(uuid) TO authenticated;
COMMIT;
