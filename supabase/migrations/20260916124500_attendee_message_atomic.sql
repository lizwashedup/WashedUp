-- Isolated candidate; requires 20260904060000_attendee_message_send.sql.
-- Reuses its tables, vocabulary and existing notification pipeline. No provider dispatch.
-- Test the original self-tests and this migration together before activation.
BEGIN;

ALTER TABLE public.attendee_message_sends
  ADD COLUMN request_id uuid,
  ADD COLUMN submission_fingerprint text,
  ADD COLUMN review_fingerprint text,
  ADD COLUMN queued_at timestamptz;
CREATE UNIQUE INDEX attendee_message_request_unique ON public.attendee_message_sends(creator_user_id,request_id) WHERE request_id IS NOT NULL;
CREATE TABLE public.attendee_message_notifications (
  message_id uuid NOT NULL REFERENCES public.attendee_message_sends(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  -- Retain the queue receipt even if the member later clears a notification.
  notification_id uuid NOT NULL,
  PRIMARY KEY(message_id,user_id), UNIQUE(notification_id)
);
ALTER TABLE public.attendee_message_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendee_message_notifications FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.attendee_message_sends FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,event_id,creator_user_id,kind,essential_reason,subject,body,reply_to,audience_filter,recipient_count,push_attempted,email_attempted,created_at,request_id,queued_at)
  ON public.attendee_message_sends TO authenticated;
DROP POLICY organizer_sends_attendee_messages ON public.attendee_message_sends;
DROP POLICY organizer_reads_own_attendee_message_sends ON public.attendee_message_sends;

CREATE OR REPLACE FUNCTION public.attendee_message_is_event_organizer(p_event_id uuid,p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p_user_id IS NOT NULL AND p_user_id=auth.uid() AND public.is_ticketing_organizer(p_event_id,p_user_id);
$$;
CREATE POLICY organizer_reads_attendee_message_history ON public.attendee_message_sends FOR SELECT
 USING(public.attendee_message_is_event_organizer(event_id,(SELECT auth.uid())));

-- Private normalization is shared by preview, submission and queue reconciliation.
CREATE FUNCTION public.attendee_message_payload(p_message jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE f jsonb; kind text; reason text; subject text; body text; reply text;
BEGIN
 IF p_message IS NULL OR jsonb_typeof(p_message)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_message) k WHERE k NOT IN ('kind','essentialReason','subject','body','replyTo','audience')) THEN RAISE EXCEPTION 'Invalid message'; END IF;
 kind:=p_message->>'kind';reason:=nullif(p_message->>'essentialReason','');
 IF kind IS NULL OR kind NOT IN ('promotional','essential') OR (kind='essential' AND (reason IS NULL OR reason NOT IN ('cancellation','venue_change','time_change'))) OR (kind='promotional' AND reason IS NOT NULL) THEN RAISE EXCEPTION 'Invalid update type or reason'; END IF;
 IF jsonb_typeof(p_message->'subject') IS DISTINCT FROM 'string' OR jsonb_typeof(p_message->'body') IS DISTINCT FROM 'string' OR (p_message ? 'replyTo' AND jsonb_typeof(p_message->'replyTo') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'Invalid message text'; END IF;
 subject:=btrim(p_message->>'subject');body:=btrim(p_message->>'body');reply:=nullif(btrim(p_message->>'replyTo'),'');
 IF subject='' OR body='' OR char_length(subject)>160 OR char_length(body)>5000 OR char_length(reply)>200 OR (reply IS NOT NULL AND reply !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'Invalid message text'; END IF;
 f:=coalesce(p_message->'audience','{}'::jsonb);
 IF jsonb_typeof(f)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(f) k WHERE k NOT IN ('search','tier','checkedIn','refunded')) THEN RAISE EXCEPTION 'Invalid audience'; END IF;
 IF (f ? 'search' AND jsonb_typeof(f->'search') IS DISTINCT FROM 'string') OR (f ? 'tier' AND jsonb_typeof(f->'tier') NOT IN ('string','null')) OR (f ? 'checkedIn' AND coalesce(f->>'checkedIn','') NOT IN ('all','in','out')) OR (f ? 'refunded' AND coalesce(f->>'refunded','') NOT IN ('all','yes','no')) THEN RAISE EXCEPTION 'Invalid audience'; END IF;
 f:=jsonb_build_object('search',btrim(coalesce(f->>'search','')),'tier',coalesce(f->>'tier',''),'checkedIn',coalesce(f->>'checkedIn','all'),'refunded',coalesce(f->>'refunded','all'));
 RETURN jsonb_build_object('kind',kind,'essentialReason',reason,'subject',subject,'body',body,'replyTo',reply,'audience',f);
END $$;

CREATE FUNCTION public.attendee_message_recipients(p_event_id uuid,p_payload jsonb) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH f AS (SELECT p_payload->'audience' AS a), candidates AS (
  SELECT o.buyer_user_id AS user_id FROM public.ticket_orders o
  JOIN public.ticket_order_positions p ON p.order_id=o.id
  JOIN public.ticket_tiers t ON t.id=o.tier_id CROSS JOIN f
  WHERE o.event_id=p_event_id AND o.status IN ('paid','refunded') AND o.buyer_user_id IS NOT NULL
   AND (f.a->>'tier'='' OR t.name=f.a->>'tier')
   AND (f.a->>'search'='' OR strpos(lower(o.buyer_name_snapshot),lower(f.a->>'search'))>0 OR strpos(lower(p.reference_code),lower(f.a->>'search'))>0)
   -- A voided scan is not admission. Match the existing native live-seat rule.
   AND (f.a->>'checkedIn'='all' OR (o.status='paid' AND p.voided_at IS NULL AND
     (EXISTS(SELECT FROM public.ticket_checkins c WHERE c.position_id=p.id AND c.result='admitted'))=(f.a->>'checkedIn'='in')))
   AND (f.a->>'refunded'='all' OR ((p.refunded_cents>0 OR p.voided_at IS NOT NULL)=(f.a->>'refunded'='yes')))
  UNION
  SELECT r.user_id FROM public.explore_event_rsvps r CROSS JOIN f
  WHERE r.explore_event_id=p_event_id AND r.status='going' AND f.a->>'search'='' AND f.a->>'tier'='' AND f.a->>'checkedIn'='all' AND f.a->>'refunded'='all'
 ) SELECT coalesce(array_agg(user_id ORDER BY user_id),'{}'::uuid[]) FROM candidates
 WHERE user_id<>auth.uid() AND (p_payload->>'kind'='essential' OR NOT EXISTS(SELECT FROM public.attendee_message_opt_outs x WHERE x.event_id=p_event_id AND x.user_id=candidates.user_id));
$$;
CREATE FUNCTION public.attendee_message_fingerprint(p_event_id uuid,p_payload jsonb,p_recipients uuid[]) RETURNS text
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT encode(extensions.digest(jsonb_build_object('event',p_event_id,'creator',auth.uid(),'message',p_payload,'recipients',p_recipients)::text,'sha256'),'hex');
$$;
CREATE FUNCTION public.preview_attendee_message(p_event_id uuid,p_message jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE payload jsonb; recipients uuid[];
BEGIN
 IF NOT coalesce(public.attendee_message_is_event_organizer(p_event_id,auth.uid()),false) THEN RAISE EXCEPTION 'Event communication access denied'; END IF;
 payload:=public.attendee_message_payload(p_message);recipients:=public.attendee_message_recipients(p_event_id,payload);
 RETURN jsonb_build_object('eventId',p_event_id,'recipientCount',cardinality(recipients),'reviewHash',public.attendee_message_fingerprint(p_event_id,payload,recipients),'channel','in_app_push','providerDeliveryConfirmed',false);
END $$;

-- Event-wide serialization, including different creators. Preserve the existing UTC day boundary.
CREATE OR REPLACE FUNCTION public.enforce_attendee_message_daily_cap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE used integer;
BEGIN
 IF NEW.kind<>'promotional' THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.explore_events WHERE id=NEW.event_id FOR UPDATE;
 SELECT count(*) INTO used FROM public.attendee_message_sends WHERE event_id=NEW.event_id AND kind='promotional'
 AND created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
 IF used>=3 THEN RAISE EXCEPTION 'attendee message daily cap reached'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fanout_attendee_message_push(p_message_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.attendee_message_sends%rowtype; payload jsonb; recipients uuid[]; recipient uuid; notification uuid; queued integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 SELECT * INTO m FROM public.attendee_message_sends WHERE id=p_message_id FOR UPDATE;
 IF m.id IS NULL OR m.creator_user_id<>auth.uid() OR NOT coalesce(public.attendee_message_is_event_organizer(m.event_id,auth.uid()),false) THEN RAISE EXCEPTION 'Message access denied'; END IF;
 IF m.queued_at IS NOT NULL THEN SELECT count(*) INTO queued FROM public.attendee_message_notifications WHERE message_id=m.id;RETURN queued; END IF;
 IF m.request_id IS NULL OR m.review_fingerprint IS NULL THEN RAISE EXCEPTION 'Legacy message requires review before queuing'; END IF;
 payload:=jsonb_build_object('kind',m.kind,'essentialReason',m.essential_reason,'subject',m.subject,'body',m.body,'replyTo',m.reply_to,'audience',m.audience_filter);
 recipients:=public.attendee_message_recipients(m.event_id,payload);
 IF recipients IS DISTINCT FROM m.recipient_user_ids OR public.attendee_message_fingerprint(m.event_id,payload,recipients) IS DISTINCT FROM m.review_fingerprint THEN RAISE EXCEPTION 'Message audience changed; review again'; END IF;
 FOREACH recipient IN ARRAY recipients LOOP
  notification:=gen_random_uuid();
  INSERT INTO public.app_notifications(id,user_id,type,title,body,explore_event_id,actor_user_id,status,push_sent,push_suppressed)
  VALUES(notification,recipient,'broadcast',m.subject,m.body,m.event_id,auth.uid(),'unread',false,false);
  INSERT INTO public.attendee_message_notifications(message_id,user_id,notification_id) VALUES(m.id,recipient,notification);
 END LOOP;
 UPDATE public.attendee_message_sends SET queued_at=now(),push_attempted=true WHERE id=m.id;
 RETURN cardinality(recipients);
END $$;

CREATE FUNCTION public.get_attendee_message_receipt(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.attendee_message_sends%rowtype; queued integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 SELECT * INTO m FROM public.attendee_message_sends WHERE creator_user_id=auth.uid() AND request_id=p_request_id;
 IF m.id IS NULL THEN RETURN NULL; END IF;
 IF NOT coalesce(public.attendee_message_is_event_organizer(m.event_id,auth.uid()),false) THEN RAISE EXCEPTION 'Message access denied'; END IF;
 IF m.queued_at IS NOT NULL THEN SELECT count(*) INTO queued FROM public.attendee_message_notifications WHERE message_id=m.id; END IF;
 RETURN jsonb_build_object('id',m.id,'requestId',m.request_id,'eventId',m.event_id,'recipientCount',m.recipient_count,'deliveryStatus',CASE WHEN m.queued_at IS NULL THEN 'unconfirmed' ELSE 'queued' END,'pushQueuedCount',queued,'createdAt',m.created_at,'providerDeliveryConfirmed',false);
END $$;

CREATE FUNCTION public.submit_attendee_message(p_event_id uuid,p_request_id uuid,p_message jsonb,p_review_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload jsonb; recipients uuid[]; fingerprint text; m public.attendee_message_sends%rowtype; message_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.attendee_message_is_event_organizer(p_event_id,auth.uid()),false) THEN RAISE EXCEPTION 'Event communication access denied'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable request ID is required'; END IF;
 payload:=public.attendee_message_payload(p_message);
 fingerprint:=public.attendee_message_fingerprint(p_event_id,payload,'{}'::uuid[]);
 -- Serialize this creator's request key across events, then the whole event's cap.
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
 PERFORM 1 FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 SELECT * INTO m FROM public.attendee_message_sends WHERE creator_user_id=auth.uid() AND request_id=p_request_id;
 IF m.id IS NOT NULL THEN
  IF m.event_id<>p_event_id OR m.submission_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Request ID already belongs to a different message'; END IF;
  RETURN public.get_attendee_message_receipt(p_request_id);
 END IF;
 recipients:=public.attendee_message_recipients(p_event_id,payload);
 IF cardinality(recipients)=0 THEN RAISE EXCEPTION 'No recipients match this audience'; END IF;
 IF p_review_hash IS NULL OR public.attendee_message_fingerprint(p_event_id,payload,recipients) IS DISTINCT FROM p_review_hash THEN RAISE EXCEPTION 'Message or audience changed; review again'; END IF;
 INSERT INTO public.attendee_message_sends(event_id,creator_user_id,kind,essential_reason,subject,body,reply_to,audience_filter,recipient_user_ids,recipient_count,request_id,submission_fingerprint,review_fingerprint,push_attempted,email_attempted)
 VALUES(p_event_id,auth.uid(),(payload->>'kind')::public.attendee_message_kind,(payload->>'essentialReason')::public.attendee_message_essential_reason,payload->>'subject',payload->>'body',payload->>'replyTo',payload->'audience',recipients,cardinality(recipients),p_request_id,fingerprint,p_review_hash,false,false) RETURNING id INTO message_id;
 PERFORM public.fanout_attendee_message_push(message_id);
 RETURN public.get_attendee_message_receipt(p_request_id);
END $$;

REVOKE ALL ON FUNCTION public.attendee_message_payload(jsonb),public.attendee_message_recipients(uuid,jsonb),public.attendee_message_fingerprint(uuid,jsonb,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.preview_attendee_message(uuid,jsonb),public.submit_attendee_message(uuid,uuid,jsonb,text),public.get_attendee_message_receipt(uuid),public.fanout_attendee_message_push(uuid),public.attendee_message_is_event_organizer(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_attendee_message(uuid,jsonb),public.submit_attendee_message(uuid,uuid,jsonb,text),public.get_attendee_message_receipt(uuid),public.fanout_attendee_message_push(uuid),public.attendee_message_is_event_organizer(uuid,uuid) TO authenticated;
COMMENT ON TABLE public.attendee_message_notifications IS 'Internal idempotent queue receipts; not proof of provider delivery. No authenticated direct reads or writes.';
COMMIT;
