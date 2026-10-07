-- Shared creator settings only. No cron, notification queue or provider operation.
BEGIN;
CREATE TABLE public.event_reminder_settings (
 event_id uuid PRIMARY KEY REFERENCES public.explore_events(id) ON DELETE CASCADE,
 page_id uuid NOT NULL,
 day_before_on boolean NOT NULL,
 day_of_on boolean NOT NULL,
 revision uuid NOT NULL DEFAULT gen_random_uuid(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_reminder_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_reminder_settings FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_event_reminder_settings(p_event_id uuid) RETURNS jsonb
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
  'eventStatus',e.status,'deliveryReady',false);
END$$;

CREATE FUNCTION public.save_event_reminder_settings(p_event_id uuid,p_page_id uuid,p_revision uuid,p_day_before_on boolean,p_day_of_on boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_settings jsonb;
BEGIN
 PERFORM public.get_event_reminder_settings(p_event_id);
 -- The event lock serializes different editors, including the first insert.
 -- Authority is checked after the lock and again by the read used for the receipt.
 PERFORM 1 FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 current_settings:=public.get_event_reminder_settings(p_event_id);
 IF p_page_id IS NULL OR p_page_id IS DISTINCT FROM (current_settings->>'pageId')::uuid THEN
  RAISE EXCEPTION 'Event reminder access denied' USING ERRCODE='42501';
 END IF;
 IF p_day_before_on IS NULL OR p_day_of_on IS NULL THEN RAISE EXCEPTION 'Invalid reminder preferences'; END IF;
 IF current_settings->>'eventStatus' NOT IN ('Draft','Live')
 OR (current_settings->>'startsAt' IS NOT NULL AND (current_settings->>'startsAt')::timestamptz<=now()) THEN
  RAISE EXCEPTION 'This event no longer accepts reminder changes';
 END IF;
 -- A lost acknowledgement can safely confirm the already-saved desired values.
 IF current_settings->>'revision' IS NOT NULL
 AND (current_settings->>'dayBeforeOn')::boolean=p_day_before_on
 AND (current_settings->>'dayOfOn')::boolean=p_day_of_on THEN RETURN current_settings; END IF;
 IF p_revision IS DISTINCT FROM (current_settings->>'revision')::uuid THEN
  RAISE EXCEPTION 'Reminder settings changed. Review the saved settings first.' USING ERRCODE='40001';
 END IF;
 INSERT INTO public.event_reminder_settings(event_id,page_id,day_before_on,day_of_on)
 VALUES(p_event_id,p_page_id,p_day_before_on,p_day_of_on)
 ON CONFLICT(event_id) DO UPDATE SET page_id=excluded.page_id,day_before_on=excluded.day_before_on,
  day_of_on=excluded.day_of_on,revision=gen_random_uuid(),updated_at=now();
 RETURN public.get_event_reminder_settings(p_event_id);
END$$;
REVOKE ALL ON FUNCTION public.get_event_reminder_settings(uuid),public.save_event_reminder_settings(uuid,uuid,uuid,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_event_reminder_settings(uuid),public.save_event_reminder_settings(uuid,uuid,uuid,boolean,boolean) TO authenticated;
COMMENT ON TABLE public.event_reminder_settings IS 'Exact-event communication authority and optimistic concurrency. Saved settings do not schedule or send reminders until the delivery integration is enabled.';
COMMIT;
