-- Scene reminders reuse the existing in-app notice and push transport. No cron or
-- provider is enabled here. Pair the worker's decision RPC with this migration.
BEGIN;
CREATE TABLE public.scene_event_reminder_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.scene_event_reminder_policy(singleton,enabled) VALUES(true,false);
CREATE TABLE public.scene_event_reminder_deliveries (
 event_id uuid NOT NULL,
 page_id uuid NOT NULL,
 starts_at timestamptz NOT NULL,
 timing text NOT NULL CHECK(timing IN ('day_before','day_of')),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 notification_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 suppressed_at timestamptz,
 PRIMARY KEY(event_id,starts_at,timing,user_id)
);
-- Keep the delivery key after a notification is dismissed or an event deleted.
ALTER TABLE public.scene_event_reminder_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_event_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scene_event_reminder_policy,public.scene_event_reminder_deliveries FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.scene_reminder_recipient_is_current(p_event_id uuid,p_page_id uuid,p_starts_at timestamptz,p_timing text,p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT
  e.status='Live' AND public.creator_event_page_id(e.id)=p_page_id
  AND coalesce(e.start_time,e.event_date::timestamp AT TIME ZONE e.timezone)=p_starts_at
  AND (e.end_time IS NULL OR e.end_time>now())
  AND CASE p_timing
   WHEN 'day_before' THEN coalesce(s.day_before_on,true) AND now()>=p_starts_at-interval '24 hours' AND now()<p_starts_at-interval '2 hours'
   WHEN 'day_of' THEN coalesce(s.day_of_on,true) AND now()>=p_starts_at-interval '2 hours' AND now()<p_starts_at
   ELSE false END
  AND public.creator_page_audience_matches(p.audience,p_user_id)
  AND NOT public.yours_is_blocked_between(p.owner_id,p_user_id)
  AND NOT EXISTS(SELECT FROM public.attendee_message_opt_outs o WHERE o.event_id=e.id AND o.user_id=p_user_id)
  AND NOT EXISTS(SELECT FROM public.community_members m WHERE m.community_id=p.page_id AND m.user_id=p_user_id AND m.broadcasts_muted)
  AND (EXISTS(SELECT FROM public.explore_event_rsvps r WHERE r.explore_event_id=e.id AND r.user_id=p_user_id AND r.status='going')
   OR EXISTS(SELECT FROM public.ticket_orders o JOIN public.ticket_order_positions pos ON pos.order_id=o.id
    WHERE o.event_id=e.id AND o.buyer_user_id=p_user_id AND o.status='paid' AND pos.voided_at IS NULL))
 FROM public.explore_events e JOIN public.creator_page_publications p ON p.page_id=p_page_id
 LEFT JOIN public.event_reminder_settings s ON s.event_id=e.id AND s.page_id=p_page_id
 WHERE e.id=p_event_id),false);
$$;

CREATE FUNCTION public.queue_scene_event_reminders(p_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; notification uuid; queued integer:=0; enabled boolean;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Reminder scheduling access denied' USING ERRCODE='42501'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>500 THEN RAISE EXCEPTION 'Invalid reminder batch size'; END IF;
 -- Concurrent ticks do not duplicate work; a later tick catches any skipped work.
 IF NOT pg_try_advisory_xact_lock(hashtextextended('scene-event-reminder-queue',0)) THEN RETURN 0; END IF;
 SELECT p.enabled INTO enabled FROM public.scene_event_reminder_policy p WHERE singleton FOR SHARE;
 IF NOT coalesce(enabled,false) THEN RETURN 0; END IF;
 FOR candidate IN
  WITH due AS (
   SELECT e.id,p.page_id,p.owner_id,e.title,e.timezone,
    coalesce(e.start_time,e.event_date::timestamp AT TIME ZONE e.timezone) starts_at
   FROM public.explore_events e JOIN public.creator_page_publications p ON p.page_id=public.creator_event_page_id(e.id)
   WHERE e.status='Live' AND coalesce(e.start_time,e.event_date::timestamp AT TIME ZONE e.timezone)>now()
    AND coalesce(e.start_time,e.event_date::timestamp AT TIME ZONE e.timezone)<=now()+interval '24 hours'
  ), attendees AS (
   SELECT r.explore_event_id event_id,r.user_id FROM public.explore_event_rsvps r JOIN due d ON d.id=r.explore_event_id WHERE r.status='going'
   UNION
   SELECT o.event_id,o.buyer_user_id FROM public.ticket_orders o JOIN due d ON d.id=o.event_id
    JOIN public.ticket_order_positions pos ON pos.order_id=o.id WHERE o.status='paid' AND pos.voided_at IS NULL AND o.buyer_user_id IS NOT NULL
  ), candidates AS (
   SELECT d.*,a.user_id,CASE WHEN d.starts_at>now()+interval '2 hours' THEN 'day_before' ELSE 'day_of' END timing
   FROM due d JOIN attendees a ON a.event_id=d.id
  ) SELECT c.* FROM candidates c
  WHERE NOT EXISTS(SELECT FROM public.scene_event_reminder_deliveries sent WHERE sent.event_id=c.id AND sent.starts_at=c.starts_at AND sent.timing=c.timing AND sent.user_id=c.user_id)
   AND public.scene_reminder_recipient_is_current(c.id,c.page_id,c.starts_at,c.timing,c.user_id)
  ORDER BY c.id,c.user_id LIMIT p_limit
 LOOP
  -- Existing creator settings saves lock this same event before writing. Recheck
  -- after acquiring it; attendance/preferences are also checked before dispatch.
  PERFORM 1 FROM public.explore_events WHERE id=candidate.id FOR SHARE;
  IF NOT public.scene_reminder_recipient_is_current(candidate.id,candidate.page_id,candidate.starts_at,candidate.timing,candidate.user_id) THEN CONTINUE; END IF;
  notification:=gen_random_uuid();
  INSERT INTO public.scene_event_reminder_deliveries(event_id,page_id,starts_at,timing,user_id,notification_id)
  VALUES(candidate.id,candidate.page_id,candidate.starts_at,candidate.timing,candidate.user_id,notification)
  ON CONFLICT(event_id,starts_at,timing,user_id) DO NOTHING;
  IF NOT FOUND THEN CONTINUE; END IF;
  INSERT INTO public.app_notifications(id,user_id,type,title,body,explore_event_id,actor_user_id,status,push_sent,push_suppressed,expires_at)
  VALUES(notification,candidate.user_id,'broadcast','Event reminder',
   candidate.title||' starts '||to_char(candidate.starts_at AT TIME ZONE candidate.timezone,'Dy, Mon FMDD at FMHH12:MI AM')||' ('||candidate.timezone||'). Open your event for the details.',
   candidate.id,candidate.owner_id,'unread',false,false,
   candidate.starts_at-CASE WHEN candidate.timing='day_before' THEN interval '2 hours' ELSE interval '0 hours' END);
  queued:=queued+1;
 END LOOP;
 RETURN queued;
END$$;

CREATE FUNCTION public.get_scene_message_push_decisions(p_notification_ids uuid[])
RETURNS TABLE(notification_id uuid,user_id uuid,decision text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior record; delivery public.scene_event_reminder_deliveries; notice public.app_notifications;
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
  END IF;
  RETURN NEXT;
 END LOOP;
END$$;
REVOKE ALL ON FUNCTION public.scene_reminder_recipient_is_current(uuid,uuid,timestamptz,text,uuid),public.queue_scene_event_reminders(integer),public.get_scene_message_push_decisions(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.queue_scene_event_reminders(integer),public.get_scene_message_push_decisions(uuid[]) TO service_role;
COMMIT;
