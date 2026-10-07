-- Exact-event aggregate status; no recipient identifiers or delivery claims.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_event_reminder_settings(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events; s public.event_reminder_settings; page uuid;
BEGIN
 IF NOT coalesce(public.attendee_message_is_event_organizer(p_event_id,auth.uid()),false) THEN
  RAISE EXCEPTION 'Event reminder access denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id;
 page:=public.creator_event_page_id(p_event_id);
 IF e.id IS NULL OR page IS NULL THEN RAISE EXCEPTION 'Event reminder access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.event_reminder_settings WHERE event_id=p_event_id AND page_id=page;
 RETURN jsonb_build_object('eventId',e.id,'pageId',page,'dayBeforeOn',coalesce(s.day_before_on,true),
  'dayOfOn',coalesce(s.day_of_on,true),'revision',s.revision,'updatedAt',s.updated_at,
  'startsAt',coalesce(e.start_time,e.event_date::timestamp AT TIME ZONE e.timezone),
  'eventStatus',e.status,'deliveryReady',coalesce((SELECT enabled FROM public.scene_event_reminder_policy WHERE singleton),false),
  'deliverySummary',coalesce((SELECT jsonb_agg(jsonb_build_object('timing',d.timing,'queuedCount',d.queued_count,'stoppedCount',d.stopped_count,'lastQueuedAt',d.last_at) ORDER BY d.timing)
   FROM (SELECT timing,count(*) queued_count,count(*) FILTER(WHERE suppressed_at IS NOT NULL) stopped_count,max(created_at) last_at
    FROM public.scene_event_reminder_deliveries
    WHERE event_id=e.id AND page_id=page AND starts_at=coalesce(e.start_time,e.event_date::timestamp AT TIME ZONE e.timezone)
    GROUP BY timing)d),'[]'::jsonb));
END$$;
COMMIT;
