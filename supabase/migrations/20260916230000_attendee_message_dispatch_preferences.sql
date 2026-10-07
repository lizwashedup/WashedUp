-- Recheck existing event-specific opt-outs immediately before push.
-- Essential operational notices retain the established exception. No sends enabled.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_scene_message_push_decisions(p_notification_ids uuid[])
RETURNS TABLE(notification_id uuid,user_id uuid,decision text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior record; delivery public.scene_event_reminder_deliveries; notice public.app_notifications; link public.attendee_message_notifications; message public.attendee_message_sends;
BEGIN
 -- Reuse invitation authority, exact batch validation and existing suppression.
 FOR prior IN SELECT * FROM public.get_event_invitation_push_decisions(p_notification_ids) LOOP
  SELECT * INTO delivery FROM public.scene_event_reminder_deliveries d WHERE d.notification_id=prior.notification_id;
  notification_id:=prior.notification_id;user_id:=prior.user_id;decision:=prior.decision;
  IF FOUND THEN
   SELECT * INTO notice FROM public.app_notifications n WHERE n.id=prior.notification_id;
   IF delivery.suppressed_at IS NOT NULL OR notice.user_id<>delivery.user_id OR notice.push_suppressed OR notice.status<>'unread'
    OR (notice.expires_at IS NOT NULL AND notice.expires_at<=now())
    OR notice.explore_event_id IS DISTINCT FROM delivery.event_id OR notice.explore_event_origin_id IS DISTINCT FROM delivery.event_id
    OR NOT public.scene_reminder_recipient_is_current(delivery.event_id,delivery.page_id,delivery.starts_at,delivery.timing,delivery.user_id) THEN
    UPDATE public.scene_event_reminder_deliveries d SET suppressed_at=coalesce(d.suppressed_at,now()) WHERE d.notification_id=prior.notification_id;
    UPDATE public.app_notifications n SET push_suppressed=true WHERE n.id=prior.notification_id;
    decision:='suppress';
   ELSIF NOT coalesce((SELECT p.enabled FROM public.scene_event_reminder_policy p WHERE singleton),false) THEN decision:='hold';
   ELSE decision:='send'; END IF;
  ELSE
   SELECT * INTO link FROM public.attendee_message_notifications l WHERE l.notification_id=prior.notification_id;
   IF FOUND THEN
    SELECT * INTO notice FROM public.app_notifications n WHERE n.id=prior.notification_id;
    SELECT * INTO message FROM public.attendee_message_sends m WHERE m.id=link.message_id;
    -- This is the existing event-specific promotional opt-out, not marketing
    -- email consent or a new global mute. Essential operational updates retain
    -- their approved exception, including a cancellation after the event closes.
    IF notice.push_suppressed OR notice.status<>'unread'
     OR (notice.expires_at IS NOT NULL AND notice.expires_at<=now())
     OR notice.user_id<>link.user_id OR notice.explore_event_origin_id IS DISTINCT FROM message.event_id
     OR (message.kind='promotional' AND EXISTS(SELECT FROM public.attendee_message_opt_outs o WHERE o.event_id=message.event_id AND o.user_id=link.user_id)) THEN
     UPDATE public.app_notifications n SET push_suppressed=true WHERE n.id=prior.notification_id;
     decision:='suppress';
    END IF;
   END IF;
  END IF;
  RETURN NEXT;
 END LOOP;
END$$;
COMMIT;
