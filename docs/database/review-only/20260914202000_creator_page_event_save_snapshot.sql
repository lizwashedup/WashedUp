-- LOCAL / REVIEW ONLY. Bind full editable fields to the same row version.
-- Exact page/event authorization; no private application, buyer or bank fields.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_creator_page_event_save_state(p_page_id uuid,p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events;
BEGIN
 IF NOT coalesce(public.creator_page_event_save_access(p_page_id,p_event_id),false) THEN RAISE EXCEPTION 'Event unavailable for this page' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id;
 RETURN jsonb_build_object('page_id',p_page_id,'event_id',e.id,'updated_at',e.updated_at,'status',e.status,'offer_type',e.offer_type,'ticket_capacity',e.ticket_capacity,
  'latitude',e.latitude,'longitude',e.longitude,'can_manage_tickets',public.is_ticketing_organizer(e.id,auth.uid()),
  'fields',jsonb_build_object('title',coalesce(e.title,''),'description',coalesce(e.description,''),'image_url',coalesce(e.image_url,''),
   'event_date',coalesce(e.event_date::text,''),'start_time',e.start_time,'end_time',e.end_time,'venue',coalesce(e.venue,''),'venue_address',coalesce(e.venue_address,''),
   'category',coalesce(e.category,''),'external_url',coalesce(e.external_url,''),'ticket_price',coalesce(e.ticket_price::text,''),'public_name',coalesce(e.public_name,''),
   'pin_to_chat',coalesce(e.pin_to_chat,true),'description_blocks',coalesce(e.description_blocks,'[]'::jsonb),'confirmation_message',e.confirmation_message));
END;
$$;
COMMIT;
