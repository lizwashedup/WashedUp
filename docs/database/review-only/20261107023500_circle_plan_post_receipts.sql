-- PRIVATE / HELD: verify the deployed create_circle_plan contract, triggers,
-- permissions and grants on a separately approved schema copy before rollout.
BEGIN;
CREATE TABLE public.circle_plan_post_receipts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(user_id,request_id)
);
ALTER TABLE public.circle_plan_post_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.circle_plan_post_receipts FROM PUBLIC,anon,authenticated;
-- Retain the receipt if the resulting event is subsequently deleted. Retrying
-- a confirmed post must never recreate a removed plan.
CREATE FUNCTION public.circle_plan_post_status(p_circle_id uuid,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=auth.uid(); receipt public.circle_plan_post_receipts;
BEGIN
 IF u IS NULL OR NOT public.is_circle_member(p_circle_id,u) THEN
  RAISE EXCEPTION 'circle membership required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO receipt FROM public.circle_plan_post_receipts WHERE user_id=u AND request_id=p_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF receipt.circle_id<>p_circle_id THEN RAISE EXCEPTION 'request belongs to another circle' USING ERRCODE='22023'; END IF;
 RETURN receipt.result;
END $$;
CREATE FUNCTION public.create_circle_plan_once(p_request_id uuid,

  p_circle_id       uuid,
  p_title           text,
  p_start_time      timestamptz,
  p_visibility      text,
  p_stranger_cap    integer     DEFAULT NULL,
  p_gender_rule     text        DEFAULT 'mixed',
  p_member_user_ids uuid[]      DEFAULT NULL,
  p_description     text        DEFAULT NULL,
  p_end_time        timestamptz DEFAULT NULL,
  p_drop_in         boolean     DEFAULT true,
  p_location_text   text        DEFAULT NULL,
  p_location_lat    numeric     DEFAULT NULL,
  p_location_lng    numeric     DEFAULT NULL,
  p_primary_vibe    text        DEFAULT NULL,
  p_target_age_min  integer     DEFAULT NULL,
  p_target_age_max  integer     DEFAULT NULL,
  p_host_message    text        DEFAULT NULL,
  p_image_url       text        DEFAULT NULL,
  p_neighborhood    text        DEFAULT NULL,
  p_tickets_url     text        DEFAULT NULL,
  p_city            text        DEFAULT 'Los Angeles'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=auth.uid(); receipt public.circle_plan_post_receipts; chosen jsonb; outcome jsonb;
BEGIN
 IF u IS NULL OR p_request_id IS NULL OR NOT public.is_circle_member(p_circle_id,u) THEN
  RAISE EXCEPTION 'circle membership required' USING ERRCODE='42501';
 END IF;
 chosen:=jsonb_build_object('p_circle_id',p_circle_id,
    'p_title',p_title,
    'p_start_time',p_start_time,
    'p_visibility',p_visibility,
    'p_stranger_cap',p_stranger_cap,
    'p_gender_rule',p_gender_rule,
    'p_member_user_ids',p_member_user_ids,
    'p_description',p_description,
    'p_end_time',p_end_time,
    'p_drop_in',p_drop_in,
    'p_location_text',p_location_text,
    'p_location_lat',p_location_lat,
    'p_location_lng',p_location_lng,
    'p_primary_vibe',p_primary_vibe,
    'p_target_age_min',p_target_age_min,
    'p_target_age_max',p_target_age_max,
    'p_host_message',p_host_message,
    'p_image_url',p_image_url,
    'p_neighborhood',p_neighborhood,
    'p_tickets_url',p_tickets_url,
    'p_city',p_city);
 PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':'||p_request_id::text,0));
 SELECT * INTO receipt FROM public.circle_plan_post_receipts WHERE user_id=u AND request_id=p_request_id;
 IF FOUND THEN
  IF receipt.circle_id<>p_circle_id OR receipt.payload IS DISTINCT FROM chosen THEN
   RAISE EXCEPTION 'post request differs from the original' USING ERRCODE='22023';
  END IF;
  RETURN receipt.result;
 END IF;
 -- Delegate the actual writes to the existing function in the same transaction.
 -- A refusal rolls back both the plan and receipt. An overlapping exact retry
 -- waits for the first transaction and reads its receipt instead of writing.
 outcome:=public.create_circle_plan(p_circle_id=>p_circle_id,
    p_title=>p_title,
    p_start_time=>p_start_time,
    p_visibility=>p_visibility,
    p_stranger_cap=>p_stranger_cap,
    p_gender_rule=>p_gender_rule,
    p_member_user_ids=>p_member_user_ids,
    p_description=>p_description,
    p_end_time=>p_end_time,
    p_drop_in=>p_drop_in,
    p_location_text=>p_location_text,
    p_location_lat=>p_location_lat,
    p_location_lng=>p_location_lng,
    p_primary_vibe=>p_primary_vibe,
    p_target_age_min=>p_target_age_min,
    p_target_age_max=>p_target_age_max,
    p_host_message=>p_host_message,
    p_image_url=>p_image_url,
    p_neighborhood=>p_neighborhood,
    p_tickets_url=>p_tickets_url,
    p_city=>p_city);
 IF outcome->>'event_id' IS NULL OR jsonb_typeof(outcome->'has_own_chat') IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'invalid plan receipt';
 END IF;
 INSERT INTO public.circle_plan_post_receipts(user_id,request_id,circle_id,payload,result)
 VALUES(u,p_request_id,p_circle_id,chosen,outcome);
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.circle_plan_post_status(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.circle_plan_post_status(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_circle_plan_once(uuid,uuid,text,timestamptz,text,integer,text,uuid[],text,timestamptz,boolean,text,numeric,numeric,text,integer,integer,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_circle_plan_once(uuid,uuid,text,timestamptz,text,integer,text,uuid[],text,timestamptz,boolean,text,numeric,numeric,text,integer,integer,text,text,text,text,text) TO authenticated;
COMMIT;
