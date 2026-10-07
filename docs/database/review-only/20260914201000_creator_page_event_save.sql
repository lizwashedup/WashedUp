-- LOCAL / REVIEW ONLY. Atomic saving through existing page-event routines.
-- Does not publish, create an event, change attribution or broaden ticket authority.
BEGIN;
CREATE TABLE public.creator_page_event_save_attempts (
 request_id uuid PRIMARY KEY, page_id uuid NOT NULL, event_id uuid NOT NULL, user_id uuid NOT NULL,
 request_hash text NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.creator_page_event_save_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_event_save_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.creator_page_event_save_access(p_page_id uuid,p_event_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.creator_page_events l WHERE l.page_id=p_page_id AND l.event_id=p_event_id)
 AND public.creator_event_can_manage(p_event_id);
$$;
REVOKE ALL ON FUNCTION public.creator_page_event_save_access(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_creator_page_event_save_state(p_page_id uuid,p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id;
 RETURN jsonb_build_object('page_id',p_page_id,'event_id',e.id,'updated_at',e.updated_at,'status',e.status,'offer_type',e.offer_type,'ticket_capacity',e.ticket_capacity,
  'latitude',e.latitude,'longitude',e.longitude,'can_manage_tickets',public.is_ticketing_organizer(e.id,auth.uid()));
END;
$$;
CREATE FUNCTION public.get_creator_page_event_save_attempt(p_page_id uuid,p_event_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_event_save_attempts;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_event_save_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NULL THEN RETURN NULL; END IF;
 IF a.page_id<>p_page_id OR a.event_id<>p_event_id OR a.user_id<>auth.uid() THEN RAISE EXCEPTION 'Save attempt unavailable' USING ERRCODE='42501'; END IF;
 RETURN a.receipt;
END;
$$;
CREATE FUNCTION public.save_creator_page_event(p_page_id uuid,p_event_id uuid,p_request_id uuid,p_fields jsonb,p_offer_type text,p_ticket_capacity integer,p_latitude double precision,p_longitude double precision,p_expected_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events; a public.creator_page_event_save_attempts; requested text; result jsonb; k text;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_expected_updated_at IS NULL OR jsonb_typeof(p_fields) IS DISTINCT FROM 'object'
 OR NOT p_fields ?& ARRAY['title','description','image_url','event_date','start_time','end_time','venue','venue_address','category','external_url','ticket_price','public_name','pin_to_chat']
 OR p_offer_type IS NULL OR p_offer_type NOT IN('free_event','ticketed_event','course','drop_in')
 OR (p_ticket_capacity IS NOT NULL AND p_ticket_capacity<=0) THEN RAISE EXCEPTION 'Check the event fields and offer settings' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_fields) LOOP
  IF k NOT IN('title','description','image_url','event_date','start_time','end_time','venue','venue_address','category','external_url','ticket_price','public_name','pin_to_chat','description_blocks','confirmation_message')
   OR (k IN('title','description','image_url','event_date','venue','venue_address','category','external_url','ticket_price','public_name') AND jsonb_typeof(p_fields->k)<>'string')
   OR (k IN('start_time','end_time','confirmation_message') AND jsonb_typeof(p_fields->k) NOT IN('string','null'))
   OR (k='pin_to_chat' AND jsonb_typeof(p_fields->k)<>'boolean')
   OR (k='description_blocks' AND jsonb_typeof(p_fields->k) NOT IN('array','null')) THEN RAISE EXCEPTION 'Check the complete saved event fields' USING ERRCODE='22023'; END IF;
 END LOOP;
 requested:=encode(sha256(convert_to(jsonb_build_object('fields',p_fields,'offer_type',p_offer_type,'ticket_capacity',p_ticket_capacity,'latitude',p_latitude,'longitude',p_longitude,'expected_updated_at',p_expected_updated_at)::text,'UTF8')),'hex');
 -- Existing row lock serializes full saves and existing offer writes.
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 -- Revalidate after any lock wait and before mutation.
 IF e.id IS NULL OR NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_event_save_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.event_id<>p_event_id OR a.user_id<>auth.uid() OR a.request_hash<>requested THEN RAISE EXCEPTION 'Save attempt does not match' USING ERRCODE='22023'; END IF;
  RETURN a.receipt;
 END IF;
 IF e.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'This event changed. Reload it before saving.' USING ERRCODE='PT409'; END IF;
 IF e.status NOT IN('Draft','Live') THEN RAISE EXCEPTION 'This event is closed' USING ERRCODE='PT409'; END IF;
 PERFORM public.operator_update_explore_event(p_event_id=>e.id,p_title=>p_fields->>'title',p_description=>p_fields->>'description',p_image_url=>p_fields->>'image_url',
  p_event_date=>p_fields->>'event_date',p_start_time=>(p_fields->>'start_time')::timestamptz,p_end_time=>(p_fields->>'end_time')::timestamptz,p_venue=>p_fields->>'venue',p_venue_address=>p_fields->>'venue_address',
  p_category=>p_fields->>'category',p_external_url=>p_fields->>'external_url',p_ticket_price=>p_fields->>'ticket_price',p_public_name=>p_fields->>'public_name',p_pin_to_chat=>(p_fields->>'pin_to_chat')::boolean,p_status=>NULL,
  p_description_blocks=>NULLIF(p_fields->'description_blocks','null'::jsonb),p_confirmation_message=>CASE WHEN p_fields ? 'confirmation_message' THEN p_fields->>'confirmation_message' ELSE e.confirmation_message END);
 PERFORM public.operator_set_explore_event_coords(e.id,p_latitude,p_longitude);
 -- Content delegates can retain existing financial setup. Actual changes still
 -- call the existing independently authorized setters; any denial rolls back
 -- the ENTIRE save, including core fields and coordinates.
 IF e.offer_type::text IS DISTINCT FROM p_offer_type THEN PERFORM public.operator_set_event_offer_type(e.id,p_offer_type); END IF;
 IF e.ticket_capacity IS DISTINCT FROM p_ticket_capacity THEN PERFORM public.operator_set_event_ticket_capacity(e.id,p_ticket_capacity); END IF;
 result:=public.get_creator_page_event_save_state(p_page_id,p_event_id)||jsonb_build_object('request_id',p_request_id,'user_id',auth.uid());
 INSERT INTO public.creator_page_event_save_attempts(request_id,page_id,event_id,user_id,request_hash,receipt) VALUES(p_request_id,p_page_id,p_event_id,auth.uid(),requested,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_event_save_state(uuid,uuid),public.get_creator_page_event_save_attempt(uuid,uuid,uuid),public.save_creator_page_event(uuid,uuid,uuid,jsonb,text,integer,double precision,double precision,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_event_save_state(uuid,uuid),public.get_creator_page_event_save_attempt(uuid,uuid,uuid),public.save_creator_page_event(uuid,uuid,uuid,jsonb,text,integer,double precision,double precision,timestamptz) TO authenticated;
COMMIT;
