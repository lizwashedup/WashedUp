-- A stale preference version is an application conflict, not a retryable SQL transaction.
-- Preserve the existing event lock, scope and receipt behavior. No queue/provider operation.
BEGIN;
CREATE OR REPLACE FUNCTION public.save_event_reminder_settings(p_event_id uuid,p_page_id uuid,p_revision uuid,p_day_before_on boolean,p_day_of_on boolean) RETURNS jsonb
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
  RAISE EXCEPTION 'Reminder settings changed. Review the saved settings first.';
 END IF;
 INSERT INTO public.event_reminder_settings(event_id,page_id,day_before_on,day_of_on)
 VALUES(p_event_id,p_page_id,p_day_before_on,p_day_of_on)
 ON CONFLICT(event_id) DO UPDATE SET page_id=excluded.page_id,day_before_on=excluded.day_before_on,
  day_of_on=excluded.day_of_on,revision=gen_random_uuid(),updated_at=now();
 RETURN public.get_event_reminder_settings(p_event_id);
END$$;
COMMIT;
