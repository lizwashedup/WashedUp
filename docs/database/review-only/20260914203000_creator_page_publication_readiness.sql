-- LOCAL / REVIEW ONLY. Enforce saved-event readiness on explicit page publication.
-- Reuses existing authorization, financial identity, same-event update and chat.
BEGIN;
DO $$ BEGIN IF md5(pg_get_functiondef('public.publish_creator_page_event(uuid,uuid)'::regprocedure))<>'0f83407ebd000edf4b41c04328a6d60c' THEN RAISE EXCEPTION 'Reconcile current page publisher before readiness correction'; END IF; END $$;
CREATE OR REPLACE FUNCTION public.publish_creator_page_event(p_page_id uuid, p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.creator_page_drafts; e public.explore_events; v_readiness jsonb;
BEGIN
 SELECT * INTO p FROM public.creator_page_drafts WHERE id=p_page_id FOR UPDATE;
 IF auth.uid() IS NULL OR p.id IS NULL OR (p.owner_id<>auth.uid() AND NOT (p.page_kind='community' AND public.is_community_leader(p.id,auth.uid())) AND NOT public.creator_page_team_can_manage(p.id,'page_events')) OR NOT public.creator_page_is_visible(p.id) THEN
  RAISE EXCEPTION 'Publish your approved page before its event' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.creator_page_events WHERE page_id=p.id AND event_id=p_event_id) THEN
  RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF e.status='Live' THEN RETURN e.id; END IF;
 IF e.status<>'Draft' THEN RAISE EXCEPTION 'This event cannot be published' USING ERRCODE='PT409'; END IF;
 -- Every explicit page publication checks the saved event and its financial
 -- organizer. An owner or legacy role is not a readiness exemption.
 v_readiness:=public.creator_page_event_readiness(p.id,e.id);
 IF NOT (v_readiness->>'publish_ready')::boolean THEN
  RAISE EXCEPTION 'Finish the event publishing setup before publishing.' USING ERRCODE='PT409',DETAIL=v_readiness->>'publish_reason'; END IF;
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

COMMIT;
