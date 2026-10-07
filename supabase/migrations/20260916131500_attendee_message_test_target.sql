-- Isolated follow-up to the atomic attendee message contract; no provider dispatch.
-- Preserve the original self-only test signature and its separate 3/event/day cap.
BEGIN;
CREATE OR REPLACE FUNCTION public.send_attendee_message_test_to_self(p_event_id uuid,p_subject text,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid();subject text:=btrim(coalesce(p_subject,''));body text:=btrim(coalesce(p_body,''));notification uuid;used integer;
BEGIN
 IF uid IS NULL OR NOT coalesce(public.is_ticketing_organizer(p_event_id,uid),false) THEN RAISE EXCEPTION 'Event communication access denied';END IF;
 IF subject='' OR char_length(subject)>160 OR body='' OR char_length(body)>2000 THEN RAISE EXCEPTION 'Invalid test message';END IF;
 -- Serialize the existing per-event/per-sender test limit without changing the real-send cap.
 PERFORM 1 FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 SELECT count(*) INTO used FROM public.app_notifications
 WHERE explore_event_id=p_event_id AND user_id=uid AND actor_user_id=uid AND type='broadcast'
 AND created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
 IF used>=3 THEN RAISE EXCEPTION 'test-send daily limit reached';END IF;
 INSERT INTO public.app_notifications(user_id,type,title,body,explore_event_id,actor_user_id,status,push_sent,push_suppressed)
 VALUES(uid,'broadcast',subject,body,p_event_id,uid,'unread',false,false) RETURNING id INTO notification;
 RETURN notification;
END $$;
REVOKE ALL ON FUNCTION public.send_attendee_message_test_to_self(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.send_attendee_message_test_to_self(uuid,text,text) TO authenticated;
COMMIT;
