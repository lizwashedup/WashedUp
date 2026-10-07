-- LOCAL / REVIEW ONLY. Explicit categories, retaining the original primary category and access checks.
BEGIN;
ALTER TABLE public.explore_events ADD COLUMN categories text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.explore_events ADD CONSTRAINT event_categories_limit CHECK(cardinality(categories)<=2);
CREATE FUNCTION public.validate_event_categories(p_categories text[],p_community boolean DEFAULT false,p_legacy text DEFAULT NULL) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text[];
BEGIN
 IF p_categories IS NULL OR cardinality(p_categories) NOT BETWEEN 1 AND 2 OR array_ndims(p_categories)<>1
 OR EXISTS(SELECT 1 FROM unnest(p_categories) c WHERE c IS NULL OR c NOT IN('music','comedy','nightlife','food and drink','art','fitness','outdoors','community','film','markets','gaming','business & networking','just for fun','other','fitness and outdoors') AND c IS DISTINCT FROM lower(p_legacy))
 OR (SELECT count(DISTINCT c) FROM unnest(p_categories)c)<>cardinality(p_categories)
 THEN RAISE EXCEPTION 'Choose one or two different categories' USING ERRCODE='22023'; END IF;
 result:=p_categories;
 IF p_community AND NOT 'community'=ANY(result) THEN result:=array_prepend('community',result); END IF;
 IF cardinality(result)>2 THEN RAISE EXCEPTION 'Community events include Community and one optional category' USING ERRCODE='22023'; END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.validate_event_categories(text[],boolean,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE public.creator_page_event_category_attempts(event_id uuid PRIMARY KEY,page_id uuid NOT NULL,user_id uuid NOT NULL,title text NOT NULL,categories text[] NOT NULL);
ALTER TABLE public.creator_page_event_category_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_event_category_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_creator_page_event_draft_with_categories(p_page_id uuid,p_event_id uuid,p_title text,p_categories text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_event_category_attempts; result uuid; selected text[]; community boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to continue' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text,0));
 SELECT page_kind='community' INTO community FROM public.creator_page_drafts WHERE id=p_page_id;
 selected:=public.validate_event_categories(p_categories,coalesce(community,false));
 SELECT * INTO a FROM public.creator_page_event_category_attempts WHERE event_id=p_event_id;
 IF a.event_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.user_id<>auth.uid() OR a.title<>btrim(p_title) OR a.categories<>selected THEN RAISE EXCEPTION 'This saved event attempt does not match' USING ERRCODE='22023'; END IF;
  -- Recheck exact page authority; never replay category writes over later edits.
  RETURN public.create_creator_page_event_draft(p_page_id,p_event_id,p_title,selected[1]);
 END IF;
 IF EXISTS(SELECT 1 FROM public.explore_events WHERE id=p_event_id) THEN RAISE EXCEPTION 'Check the original event before continuing' USING ERRCODE='PT409'; END IF;
 result:=public.create_creator_page_event_draft(p_page_id,p_event_id,p_title,selected[1]);
 UPDATE public.explore_events SET categories=selected WHERE id=result;
 INSERT INTO public.creator_page_event_category_attempts VALUES(result,p_page_id,auth.uid(),btrim(p_title),selected);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.create_creator_page_event_draft_with_categories(uuid,uuid,text,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_creator_page_event_draft_with_categories(uuid,uuid,text,text[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_creator_page_event_save_state(p_page_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE e public.explore_events;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id;
 RETURN jsonb_build_object('page_id',p_page_id,'event_id',e.id,'updated_at',e.updated_at,'status',e.status,'offer_type',e.offer_type,'ticket_capacity',e.ticket_capacity,
  'latitude',e.latitude,'longitude',e.longitude,'can_manage_tickets',public.is_ticketing_organizer(e.id,auth.uid()),
  'fields',jsonb_build_object('title',coalesce(e.title,''),'description',coalesce(e.description,''),'image_url',coalesce(e.image_url,''),
   'event_date',coalesce(e.event_date::text,''),'start_time',e.start_time,'end_time',e.end_time,'venue',coalesce(e.venue,''),'venue_address',coalesce(e.venue_address,''),
   'category',coalesce(e.category,''),'categories',CASE WHEN cardinality(e.categories)>0 THEN to_jsonb(e.categories) ELSE to_jsonb(array_remove(ARRAY[e.category],NULL)) END,'external_url',coalesce(e.external_url,''),'ticket_price',coalesce(e.ticket_price::text,''),'public_name',coalesce(e.public_name,''),
   'pin_to_chat',coalesce(e.pin_to_chat,true),'description_blocks',coalesce(e.description_blocks,'[]'::jsonb),'confirmation_message',e.confirmation_message));
END;
$function$;
CREATE OR REPLACE FUNCTION public.save_creator_page_event(p_page_id uuid, p_event_id uuid, p_request_id uuid, p_fields jsonb, p_offer_type text, p_ticket_capacity integer, p_latitude double precision, p_longitude double precision, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE e public.explore_events; a public.creator_page_event_save_attempts; requested text; result jsonb; k text;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_expected_updated_at IS NULL OR jsonb_typeof(p_fields) IS DISTINCT FROM 'object'
 OR NOT p_fields ?& ARRAY['title','description','image_url','event_date','start_time','end_time','venue','venue_address','category','external_url','ticket_price','public_name','pin_to_chat']
 OR p_offer_type IS NULL OR p_offer_type NOT IN('free_event','ticketed_event','course','drop_in')
 OR (p_ticket_capacity IS NOT NULL AND p_ticket_capacity<=0) THEN RAISE EXCEPTION 'Check the event fields and offer settings' USING ERRCODE='22023'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_fields) LOOP
  IF k NOT IN('title','description','image_url','event_date','start_time','end_time','venue','venue_address','category','external_url','ticket_price','public_name','pin_to_chat','description_blocks','confirmation_message','categories')
   OR (k IN('title','description','image_url','event_date','venue','venue_address','category','external_url','ticket_price','public_name') AND jsonb_typeof(p_fields->k)<>'string')
   OR (k IN('start_time','end_time','confirmation_message') AND jsonb_typeof(p_fields->k) NOT IN('string','null'))
   OR (k='pin_to_chat' AND jsonb_typeof(p_fields->k)<>'boolean')
   OR (k='categories' AND jsonb_typeof(p_fields->k)<>'array')
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
 IF p_fields ? 'categories' THEN
  IF p_fields->'categories'->>0 IS DISTINCT FROM p_fields->>'category' THEN RAISE EXCEPTION 'Primary category does not match' USING ERRCODE='22023'; END IF;
  UPDATE public.explore_events SET categories=public.validate_event_categories(ARRAY(SELECT jsonb_array_elements_text(p_fields->'categories')),e.community_id IS NOT NULL,e.category) WHERE id=e.id;
 END IF;
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
$function$;
CREATE OR REPLACE FUNCTION public.operator_create_explore_event_with_categories(p_title text, p_description text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_event_date text DEFAULT NULL::text, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_venue text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_external_url text DEFAULT NULL::text, p_ticket_price text DEFAULT NULL::text, p_community_id uuid DEFAULT NULL::uuid, p_public_name text DEFAULT NULL::text, p_pin_to_chat boolean DEFAULT true, p_publish boolean DEFAULT true, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description_blocks jsonb DEFAULT NULL::jsonb, p_confirmation_message text DEFAULT NULL::text, p_categories text[] DEFAULT NULL::text[])
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE result uuid; selected text[]; BEGIN
selected:=public.validate_event_categories(coalesce(p_categories,ARRAY[p_category]),p_community_id IS NOT NULL);
result:=public.operator_create_explore_event(p_title=>p_title,p_description=>p_description,p_image_url=>p_image_url,p_event_date=>p_event_date,p_start_time=>p_start_time,p_venue=>p_venue,p_venue_address=>p_venue_address,p_category=>p_category,p_external_url=>p_external_url,p_ticket_price=>p_ticket_price,p_community_id=>p_community_id,p_public_name=>p_public_name,p_pin_to_chat=>p_pin_to_chat,p_publish=>p_publish,p_end_time=>p_end_time,p_description_blocks=>p_description_blocks,p_confirmation_message=>p_confirmation_message);
UPDATE public.explore_events SET categories=selected WHERE id=result;
RETURN result;
END;
$function$;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='operator_create_explore_event_with_categories' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role'; EXECUTE 'GRANT EXECUTE ON FUNCTION '||r.signature||' TO authenticated'; END LOOP; END $$;
CREATE OR REPLACE FUNCTION public.operator_update_explore_event_with_categories(p_event_id uuid, p_title text, p_description text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_event_date text DEFAULT NULL::text, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_venue text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_external_url text DEFAULT NULL::text, p_ticket_price text DEFAULT NULL::text, p_public_name text DEFAULT NULL::text, p_pin_to_chat boolean DEFAULT true, p_status text DEFAULT NULL::text, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description_blocks jsonb DEFAULT NULL::jsonb, p_confirmation_message text DEFAULT NULL::text, p_categories text[] DEFAULT NULL::text[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE selected text[]; community boolean; legacy text; BEGIN
SELECT category INTO legacy FROM public.explore_events WHERE id=p_event_id;
PERFORM public.operator_update_explore_event(p_event_id=>p_event_id,p_title=>p_title,p_description=>p_description,p_image_url=>p_image_url,p_event_date=>p_event_date,p_start_time=>p_start_time,p_venue=>p_venue,p_venue_address=>p_venue_address,p_category=>p_category,p_external_url=>p_external_url,p_ticket_price=>p_ticket_price,p_public_name=>p_public_name,p_pin_to_chat=>p_pin_to_chat,p_status=>p_status,p_end_time=>p_end_time,p_description_blocks=>p_description_blocks,p_confirmation_message=>p_confirmation_message);
SELECT community_id IS NOT NULL INTO community FROM public.explore_events WHERE id=p_event_id;
selected:=public.validate_event_categories(coalesce(p_categories,ARRAY[p_category]),coalesce(community,false),legacy);
UPDATE public.explore_events SET categories=selected WHERE id=p_event_id;
END;
$function$;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='operator_update_explore_event_with_categories' LOOP EXECUTE 'REVOKE ALL ON FUNCTION '||r.signature||' FROM PUBLIC,anon,authenticated,service_role'; EXECUTE 'GRANT EXECUTE ON FUNCTION '||r.signature||' TO authenticated'; END LOOP; END $$;
COMMIT;
