-- LOCAL / REVIEW ONLY. Durable status receipts for the existing page-event workflow.
-- No refund execution, financial grants or client-supplied content overwrite.
BEGIN;
CREATE TABLE public.creator_page_event_status_attempts (
 request_id uuid PRIMARY KEY, page_id uuid NOT NULL, event_id uuid NOT NULL, user_id uuid NOT NULL,
 requested_status text NOT NULL CHECK(requested_status IN ('Completed','Cancelled')),
 expected_updated_at timestamptz NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.creator_page_event_status_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_page_event_status_attempts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_creator_page_event_status_attempt(p_page_id uuid,p_event_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.creator_page_event_status_attempts;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_event_status_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NULL THEN RETURN NULL; END IF;
 IF a.page_id<>p_page_id OR a.event_id<>p_event_id OR a.user_id<>auth.uid() THEN RAISE EXCEPTION 'Status attempt unavailable' USING ERRCODE='42501'; END IF;
 RETURN a.receipt;
END;
$$;
CREATE FUNCTION public.set_creator_page_event_status(p_page_id uuid,p_event_id uuid,p_request_id uuid,p_status text,p_expected_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events; a public.creator_page_event_status_attempts; result jsonb;
BEGIN
 IF p_request_id IS NULL OR p_expected_updated_at IS NULL OR p_status IS NULL OR p_status NOT IN('Completed','Cancelled') THEN RAISE EXCEPTION 'Check this event action' USING ERRCODE='22023'; END IF;
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF e.id IS NULL OR NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.creator_page_event_status_attempts WHERE request_id=p_request_id;
 IF a.request_id IS NOT NULL THEN
  IF a.page_id<>p_page_id OR a.event_id<>p_event_id OR a.user_id<>auth.uid() OR a.requested_status<>p_status OR a.expected_updated_at IS DISTINCT FROM p_expected_updated_at THEN
   RAISE EXCEPTION 'Use the original event action' USING ERRCODE='22023'; END IF;
  RETURN a.receipt;
 END IF;
 IF e.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'This event changed. Review it before continuing.' USING ERRCODE='PT409'; END IF;
 IF e.status<>'Live' THEN RAISE EXCEPTION 'This event is no longer live' USING ERRCODE='PT409'; END IF;
 -- Use the locked current event, never a stale form payload. The retained
 -- routine independently enforces delegated cancellation and archives its topic.
 PERFORM public.operator_update_explore_event(p_event_id=>e.id,p_title=>e.title,p_description=>e.description,p_image_url=>e.image_url,
  p_event_date=>e.event_date::text,p_start_time=>e.start_time,p_end_time=>e.end_time,p_venue=>e.venue,p_venue_address=>e.venue_address,
  p_category=>e.category,p_external_url=>e.external_url,p_ticket_price=>e.ticket_price::text,p_public_name=>e.public_name,p_pin_to_chat=>e.pin_to_chat,
  p_status=>p_status,p_description_blocks=>e.description_blocks,p_confirmation_message=>e.confirmation_message);
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id;
 result:=jsonb_build_object('page_id',p_page_id,'event_id',e.id,'user_id',auth.uid(),'request_id',p_request_id,'status',e.status,'updated_at',e.updated_at,'expected_updated_at',p_expected_updated_at);
 INSERT INTO public.creator_page_event_status_attempts(request_id,page_id,event_id,user_id,requested_status,expected_updated_at,receipt)
 VALUES(p_request_id,p_page_id,e.id,auth.uid(),p_status,p_expected_updated_at,result);
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_event_status_attempt(uuid,uuid,uuid),public.set_creator_page_event_status(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_event_status_attempt(uuid,uuid,uuid),public.set_creator_page_event_status(uuid,uuid,uuid,text,timestamptz) TO authenticated;
COMMIT;
