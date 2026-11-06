-- REVIEW ONLY. Additive draft creation/recovery; never publishes an event.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $guard$ BEGIN
 IF to_regclass('public.operator_event_draft_attempts') IS NOT NULL THEN RAISE EXCEPTION 'Draft recovery already exists'; END IF;
 IF to_regprocedure('creator_community_is_visible(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('creator_community_is_visible(uuid)'))) IS DISTINCT FROM 'f8b427f7f67d2f16eb4294b6a56b8d6a' THEN RAISE EXCEPTION 'Event dependency changed: creator_community_is_visible'; END IF;
 IF to_regprocedure('creator_event_owner_is_eligible(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('creator_event_owner_is_eligible(uuid)'))) IS DISTINCT FROM '6e651a2a90cb7eeadf7eaa683e706631' THEN RAISE EXCEPTION 'Event dependency changed: creator_event_owner_is_eligible'; END IF;
 IF to_regprocedure('creator_event_page_id(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('creator_event_page_id(uuid)'))) IS DISTINCT FROM '29ed512cea720bb74a4ba76c7198e5de' THEN RAISE EXCEPTION 'Event dependency changed: creator_event_page_id'; END IF;
 IF to_regprocedure('creator_page_audience_matches(text,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('creator_page_audience_matches(text,uuid)'))) IS DISTINCT FROM '627fb80a7f47d9165a76175b98603be4' THEN RAISE EXCEPTION 'Event dependency changed: creator_page_audience_matches'; END IF;
 IF to_regprocedure('creator_page_is_visible(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('creator_page_is_visible(uuid)'))) IS DISTINCT FROM '4c3bf6aa1883eb85c377e75e8fe63133' THEN RAISE EXCEPTION 'Event dependency changed: creator_page_is_visible'; END IF;
 IF to_regprocedure('has_operator_grant(uuid,operator_track)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('has_operator_grant(uuid,operator_track)'))) IS DISTINCT FROM '3fa34c00448e004c6187fddcda65fc73' THEN RAISE EXCEPTION 'Event dependency changed: has_operator_grant'; END IF;
 IF to_regprocedure('has_role(uuid,app_role)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('has_role(uuid,app_role)'))) IS DISTINCT FROM '5367994289934bb02d5ed676e5b93955' THEN RAISE EXCEPTION 'Event dependency changed: has_role'; END IF;
 IF to_regprocedure('is_admin(uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('is_admin(uuid)'))) IS DISTINCT FROM 'fd1949d5b7a0d005a95d926b67aecf9a' THEN RAISE EXCEPTION 'Event dependency changed: is_admin'; END IF;
 IF to_regprocedure('is_community_leader(uuid,uuid)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('is_community_leader(uuid,uuid)'))) IS DISTINCT FROM 'd9a2d97a0ef34d456087e6df78a8c73d' THEN RAISE EXCEPTION 'Event dependency changed: is_community_leader'; END IF;
 IF to_regprocedure('operator_create_explore_event(text,text,text,text,timestamp with time zone,text,text,text,text,text,uuid,text,boolean,boolean,timestamp with time zone,jsonb,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('operator_create_explore_event(text,text,text,text,timestamp with time zone,text,text,text,text,text,uuid,text,boolean,boolean,timestamp with time zone,jsonb,text)'))) IS DISTINCT FROM '7fd27366d8185b04d03fca77e6dde8b6' THEN RAISE EXCEPTION 'Event dependency changed: operator_create_explore_event'; END IF;
 IF to_regprocedure('operator_create_explore_event_with_categories(text,text,text,text,timestamp with time zone,text,text,text,text,text,uuid,text,boolean,boolean,timestamp with time zone,jsonb,text,text[])') IS NULL OR md5(pg_get_functiondef(to_regprocedure('operator_create_explore_event_with_categories(text,text,text,text,timestamp with time zone,text,text,text,text,text,uuid,text,boolean,boolean,timestamp with time zone,jsonb,text,text[])'))) IS DISTINCT FROM '42214c352dd9ef4fadc3860fd2c0be08' THEN RAISE EXCEPTION 'Event dependency changed: operator_create_explore_event_with_categories'; END IF;
 IF to_regprocedure('operator_set_event_offer_type(uuid,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('operator_set_event_offer_type(uuid,text)'))) IS DISTINCT FROM '2b3e550cec7434dc624c7311fef69545' THEN RAISE EXCEPTION 'Event dependency changed: operator_set_event_offer_type'; END IF;
 IF to_regprocedure('operator_set_event_ticket_capacity(uuid,integer)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('operator_set_event_ticket_capacity(uuid,integer)'))) IS DISTINCT FROM '0c62dc6bed49ddfd1f570d0993a640d5' THEN RAISE EXCEPTION 'Event dependency changed: operator_set_event_ticket_capacity'; END IF;
 IF to_regprocedure('operator_set_explore_event_coords(uuid,double precision,double precision)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('operator_set_explore_event_coords(uuid,double precision,double precision)'))) IS DISTINCT FROM 'a77a14fb99d46f1a38ecaf8fe5b590d9' THEN RAISE EXCEPTION 'Event dependency changed: operator_set_explore_event_coords'; END IF;
 IF to_regprocedure('validate_event_categories(text[],boolean,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('validate_event_categories(text[],boolean,text)'))) IS DISTINCT FROM '1fc71ac81da31603ff33c30de668d176' THEN RAISE EXCEPTION 'Event dependency changed: validate_event_categories'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.explore_events'::regclass AND tgname='creator_page_event_gate' AND pg_get_triggerdef(oid)='CREATE TRIGGER creator_page_event_gate BEFORE INSERT OR UPDATE ON public.explore_events FOR EACH ROW EXECUTE FUNCTION creator_page_event_publication_guard()' AND md5(pg_get_functiondef(tgfoid))='8eac5e4ccc2f90dbd147ec691f36103a') THEN RAISE EXCEPTION 'Event trigger changed: creator_page_event_gate'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.explore_events'::regclass AND tgname='creator_page_event_media_validation' AND pg_get_triggerdef(oid)='CREATE TRIGGER creator_page_event_media_validation BEFORE INSERT OR UPDATE OF image_url, description_blocks ON public.explore_events FOR EACH ROW EXECUTE FUNCTION creator_page_event_validate_media()' AND md5(pg_get_functiondef(tgfoid))='557bae6567e06d388d90e9c3dcbcb1e1') THEN RAISE EXCEPTION 'Event trigger changed: creator_page_event_media_validation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.explore_events'::regclass AND tgname='event_category_continuity' AND pg_get_triggerdef(oid)='CREATE TRIGGER event_category_continuity BEFORE INSERT OR UPDATE OF category, categories, community_id ON public.explore_events FOR EACH ROW EXECUTE FUNCTION guard_event_category_continuity()' AND md5(pg_get_functiondef(tgfoid))='3177e6c6f43fa8ec0dcff0725c41b2f8') THEN RAISE EXCEPTION 'Event trigger changed: event_category_continuity'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.explore_events'::regclass AND tgname='event_owner_change' AND pg_get_triggerdef(oid)='CREATE TRIGGER event_owner_change BEFORE UPDATE OF owner_type, owner_user_id, owner_community_id, community_id, host_user_id ON public.explore_events FOR EACH ROW EXECUTE FUNCTION tg_event_owner_change()' AND md5(pg_get_functiondef(tgfoid))='8c1dfd87dafba2423a6a8f420a862c20') THEN RAISE EXCEPTION 'Event trigger changed: event_owner_change'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.explore_events'::regclass AND tgname='event_owner_derive' AND pg_get_triggerdef(oid)='CREATE TRIGGER event_owner_derive BEFORE INSERT ON public.explore_events FOR EACH ROW EXECUTE FUNCTION tg_event_owner_derive()' AND md5(pg_get_functiondef(tgfoid))='91ca5f3bec4a3e16eb3562c86db54f71') THEN RAISE EXCEPTION 'Event trigger changed: event_owner_derive'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.explore_events'::regclass AND tgname='explore_events_keep_paid_end_time' AND pg_get_triggerdef(oid)='CREATE TRIGGER explore_events_keep_paid_end_time BEFORE UPDATE OF end_time ON public.explore_events FOR EACH ROW EXECUTE FUNCTION tg_explore_events_keep_paid_end_time()' AND md5(pg_get_functiondef(tgfoid))='f8a5598774620f3ea435ada34cf1a12b') THEN RAISE EXCEPTION 'Event trigger changed: explore_events_keep_paid_end_time'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.explore_events'::regclass AND tgname='explore_events_valid_blocks' AND pg_get_triggerdef(oid)='CREATE TRIGGER explore_events_valid_blocks BEFORE INSERT OR UPDATE OF description_blocks ON public.explore_events FOR EACH ROW EXECUTE FUNCTION tg_explore_events_valid_blocks()' AND md5(pg_get_functiondef(tgfoid))='7ca983b9967e7228eab77c90375664a7') THEN RAISE EXCEPTION 'Event trigger changed: explore_events_valid_blocks'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.explore_events'::regclass AND tgname='explore_events_valid_timezone' AND pg_get_triggerdef(oid)='CREATE TRIGGER explore_events_valid_timezone BEFORE INSERT OR UPDATE OF timezone ON public.explore_events FOR EACH ROW EXECUTE FUNCTION tg_explore_events_valid_timezone()' AND md5(pg_get_functiondef(tgfoid))='0d521b0113f84926da49568396b2c529') THEN RAISE EXCEPTION 'Event trigger changed: explore_events_valid_timezone'; END IF;
END $guard$;
CREATE TABLE public.operator_event_draft_attempts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 event_id uuid UNIQUE REFERENCES public.explore_events(id) ON DELETE SET NULL,
 community_id uuid,
 input jsonb NOT NULL,
 receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,request_id)
);
ALTER TABLE public.operator_event_draft_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_event_draft_attempts FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.operator_event_draft_attempts IS 'Private durable receipts for request-keyed draft creation. No direct client access. Retained after event deletion to prevent recreating an old attempt.';

CREATE FUNCTION public.operator_event_draft_authorize(p_community_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid:=auth.uid();
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to create an event' USING ERRCODE='42501'; END IF;
 -- Hold the relevant grants until the creation/recovery transaction completes.
 PERFORM 1 FROM public.operator_grants WHERE user_id=actor AND status='approved'
  AND (track='event_host'::public.operator_track OR p_community_id IS NOT NULL AND track='community_leader'::public.operator_track) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event creation access is unavailable' USING ERRCODE='42501'; END IF;
 IF p_community_id IS NOT NULL THEN
  PERFORM 1 FROM public.communities WHERE id=p_community_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active community' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.community_members WHERE community_id=p_community_id AND user_id=actor
   AND status='active' AND role IN('leader','co_leader') FOR SHARE;
  IF NOT FOUND OR NOT public.is_community_leader(p_community_id,actor) THEN
   RAISE EXCEPTION 'Community event access is unavailable' USING ERRCODE='42501'; END IF;
 END IF;
END $fn$;

CREATE FUNCTION public.get_operator_event_draft_attempt(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid:=auth.uid(); attempt public.operator_event_draft_attempts; event public.explore_events;
BEGIN
 IF actor IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Sign in to check this draft' USING ERRCODE='42501'; END IF;
 -- The same account/request lock serializes reads with in-flight creation.
 PERFORM pg_advisory_xact_lock(hashtextextended('operator-draft:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO attempt FROM public.operator_event_draft_attempts WHERE user_id=actor AND request_id=p_request_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF attempt.receipt->>'status'='Cancelled' THEN RETURN attempt.receipt; END IF;
 PERFORM public.operator_event_draft_authorize(attempt.community_id);
 SELECT * INTO event FROM public.explore_events WHERE id=attempt.event_id FOR SHARE;
 IF event.id IS NULL THEN RAISE EXCEPTION 'The saved event is no longer available' USING ERRCODE='P0002'; END IF;
 IF event.host_user_id IS DISTINCT FROM actor OR event.community_id IS DISTINCT FROM attempt.community_id
   OR NOT coalesce(public.creator_event_owner_is_eligible(event.id),false) THEN
  RAISE EXCEPTION 'The saved event is unavailable for this account' USING ERRCODE='42501'; END IF;
 -- A creation receipt is historical. Never rewrite later edits during recovery.
 RETURN attempt.receipt;
END $fn$;

CREATE FUNCTION public.create_operator_event_draft(
 p_request_id uuid,p_fields jsonb,p_community_id uuid,p_offer_type text,p_ticket_capacity integer,
 p_latitude double precision,p_longitude double precision
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid:=auth.uid(); input jsonb; previous public.operator_event_draft_attempts;
 result uuid; saved public.explore_events; receipt jsonb; categories text[];
BEGIN
 IF actor IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Sign in to create this draft' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR EXISTS(
  SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN('title','description','image_url','event_date','start_time','end_time','venue','venue_address','category','categories','external_url','ticket_price','public_name','pin_to_chat','description_blocks','confirmation_message'))
 THEN RAISE EXCEPTION 'Check the draft fields' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_fields->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(p_fields->'category') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_fields->'pin_to_chat') IS DISTINCT FROM 'boolean'
  OR EXISTS(SELECT 1 FROM jsonb_each(p_fields) f WHERE f.key IN('description','image_url','event_date','start_time','end_time','venue','venue_address','external_url','ticket_price','public_name','confirmation_message') AND jsonb_typeof(f.value) NOT IN('string','null'))
  OR p_offer_type IS NULL OR p_offer_type NOT IN('free_event','ticketed_event','course','drop_in')
  OR p_ticket_capacity<=0 OR (p_latitude IS NULL)<>(p_longitude IS NULL)
  OR abs(p_latitude)>90 OR abs(p_longitude)>180
 THEN RAISE EXCEPTION 'Check the draft settings' USING ERRCODE='22023'; END IF;
 IF p_fields ? 'categories' THEN
  IF jsonb_typeof(p_fields->'categories') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields->'categories') c WHERE jsonb_typeof(c)<>'string')
  THEN RAISE EXCEPTION 'Check the event categories' USING ERRCODE='22023'; END IF;
  SELECT array_agg(value) INTO categories FROM jsonb_array_elements_text(p_fields->'categories');
  categories:=public.validate_event_categories(categories,p_community_id IS NOT NULL);
 ELSE categories:=public.validate_event_categories(ARRAY[p_fields->>'category'],p_community_id IS NOT NULL); END IF;
 input:=jsonb_build_object('fields',p_fields,'community_id',p_community_id,'offer_type',p_offer_type,
  'ticket_capacity',p_ticket_capacity,'latitude',p_latitude,'longitude',p_longitude);
 PERFORM pg_advisory_xact_lock(hashtextextended('operator-draft:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO previous FROM public.operator_event_draft_attempts WHERE user_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.input IS DISTINCT FROM input THEN RAISE EXCEPTION 'This request already belongs to another draft save' USING ERRCODE='PT409'; END IF;
  RETURN public.get_operator_event_draft_attempt(p_request_id);
 END IF;
 PERFORM public.operator_event_draft_authorize(p_community_id);
 result:=public.operator_create_explore_event_with_categories(
  p_title=>p_fields->>'title',p_description=>p_fields->>'description',p_image_url=>p_fields->>'image_url',
  p_event_date=>p_fields->>'event_date',p_start_time=>nullif(p_fields->>'start_time','')::timestamptz,
  p_venue=>p_fields->>'venue',p_venue_address=>p_fields->>'venue_address',p_category=>p_fields->>'category',
  p_external_url=>p_fields->>'external_url',p_ticket_price=>p_fields->>'ticket_price',p_community_id=>p_community_id,
  p_public_name=>p_fields->>'public_name',p_pin_to_chat=>(p_fields->>'pin_to_chat')::boolean,
  p_publish=>false,p_end_time=>nullif(p_fields->>'end_time','')::timestamptz,
  p_description_blocks=>nullif(p_fields->'description_blocks','null'::jsonb),
  p_confirmation_message=>p_fields->>'confirmation_message',p_categories=>categories);
 PERFORM public.operator_set_event_offer_type(result,p_offer_type);
 PERFORM public.operator_set_event_ticket_capacity(result,p_ticket_capacity);
 PERFORM public.operator_set_explore_event_coords(result,p_latitude,p_longitude);
 SELECT * INTO saved FROM public.explore_events WHERE id=result;
 IF saved.id IS NULL OR saved.status<>'Draft' OR saved.host_user_id IS DISTINCT FROM actor
  OR saved.community_id IS DISTINCT FROM p_community_id OR saved.offer_type::text IS DISTINCT FROM p_offer_type
  OR saved.ticket_capacity IS DISTINCT FROM p_ticket_capacity OR saved.latitude IS DISTINCT FROM p_latitude
  OR saved.longitude IS DISTINCT FROM p_longitude THEN
  RAISE EXCEPTION 'The complete draft could not be confirmed' USING ERRCODE='PT409'; END IF;
 receipt:=jsonb_build_object('version',1,'request_id',p_request_id,'user_id',actor,'event_id',result,
  'community_id',p_community_id,'status','Draft','offer_type',saved.offer_type,'ticket_capacity',saved.ticket_capacity,
  'latitude',saved.latitude,'longitude',saved.longitude,'created_at',saved.created_at);
 INSERT INTO public.operator_event_draft_attempts(user_id,request_id,event_id,community_id,input,receipt)
 VALUES(actor,p_request_id,result,p_community_id,input,receipt);
 RETURN receipt;
END $fn$;

-- Seal an unconfirmed request before returning to editing. A delayed create must
-- take the same lock and will find this tombstone. Never removes a saved event.
CREATE FUNCTION public.cancel_operator_event_draft_attempt(p_request_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE actor uuid:=auth.uid(); previous public.operator_event_draft_attempts;
 community uuid; receipt jsonb;
BEGIN
 IF actor IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Sign in to check this draft' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR jsonb_typeof(p_input->'fields') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'Check the original draft details' USING ERRCODE='22023'; END IF;
 community:=(p_input->>'community_id')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended('operator-draft:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO previous FROM public.operator_event_draft_attempts WHERE user_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF previous.input IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'This request already belongs to another draft save' USING ERRCODE='PT409'; END IF;
  IF previous.receipt->>'status'='Cancelled' THEN RETURN previous.receipt; END IF;
  IF previous.event_id IS NOT NULL THEN RETURN public.get_operator_event_draft_attempt(p_request_id); END IF;
 ELSE
  PERFORM public.operator_event_draft_authorize(community);
 END IF;
 receipt:=jsonb_build_object('version',1,'request_id',p_request_id,'user_id',actor,'event_id',NULL,
  'community_id',community,'status','Cancelled','offer_type',p_input->'offer_type',
  'ticket_capacity',p_input->'ticket_capacity','latitude',p_input->'latitude','longitude',p_input->'longitude',
  'created_at',now());
 -- Keep the historical creation receipt if its event was separately deleted.
 IF previous.receipt IS NOT NULL THEN receipt:=receipt||jsonb_build_object('previous_creation',previous.receipt); END IF;
 INSERT INTO public.operator_event_draft_attempts(user_id,request_id,event_id,community_id,input,receipt)
 VALUES(actor,p_request_id,NULL,community,p_input,receipt)
 ON CONFLICT(user_id,request_id) DO UPDATE SET receipt=EXCLUDED.receipt;
 RETURN receipt;
END $fn$;

CREATE FUNCTION public.get_operator_event_draft_capability() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to create an event' USING ERRCODE='42501'; END IF;
 RETURN 1;
END $fn$;
REVOKE ALL ON FUNCTION public.operator_event_draft_authorize(uuid),public.get_operator_event_draft_attempt(uuid),
 public.create_operator_event_draft(uuid,jsonb,uuid,text,integer,double precision,double precision),public.get_operator_event_draft_capability(),public.cancel_operator_event_draft_attempt(uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_operator_event_draft_attempt(uuid),
 public.create_operator_event_draft(uuid,jsonb,uuid,text,integer,double precision,double precision),public.get_operator_event_draft_capability(),public.cancel_operator_event_draft_attempt(uuid,jsonb)
 TO authenticated;
COMMIT;
