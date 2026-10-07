-- LOCAL / REVIEW ONLY. Retain the existing check-in transaction and duplicate semantics.
BEGIN;
CREATE FUNCTION public.record_creator_page_ticket_checkin(p_page_id uuid,p_event_id uuid,p_reference_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_event uuid;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false)
 OR NOT coalesce(public.is_ticketing_organizer(p_event_id,auth.uid()),false) THEN
  RAISE EXCEPTION 'Check-in unavailable for this page event' USING ERRCODE='42501';
 END IF;
 SELECT o.event_id INTO target_event FROM public.ticket_order_positions p
 JOIN public.ticket_orders o ON o.id=p.order_id
 WHERE p.reference_code=upper(btrim(p_reference_code)) FOR UPDATE OF p,o;
 IF target_event IS NULL OR target_event<>p_event_id THEN
  RAISE EXCEPTION 'No ticket for this event' USING ERRCODE='22023';
 END IF;
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN
  RAISE EXCEPTION 'Check-in unavailable for this page event' USING ERRCODE='42501';
 END IF;
 RETURN public.record_ticket_checkin(upper(btrim(p_reference_code)));
END;
$$;
REVOKE ALL ON FUNCTION public.record_creator_page_ticket_checkin(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_creator_page_ticket_checkin(uuid,uuid,text) TO authenticated;
COMMIT;
