-- Candidate only. Reuse Scene notifications; no SMS/email/provider dispatch.
-- Policy intentionally unset: founder paused the earlier two-per-month choice.
BEGIN;
CREATE TABLE public.event_invitation_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 period text CHECK(period IN ('week','month')),
 maximum integer CHECK(maximum > 0),
 CHECK(NOT enabled OR (period IS NOT NULL AND maximum IS NOT NULL))
);
INSERT INTO public.event_invitation_policy(singleton) VALUES(true);
CREATE TABLE public.event_invitation_sends (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 -- Context survives deletion; these fields do not grant access to deleted events/pages.
 event_id uuid NOT NULL, page_id uuid NOT NULL,
 creator_user_id uuid NOT NULL REFERENCES auth.users(id), request_id uuid NOT NULL,
 audience text NOT NULL CHECK(audience IN ('past_attendees','followers','community_members')),
 body text NOT NULL, event_title text NOT NULL, page_name text NOT NULL,
 review_fingerprint text NOT NULL, submission_fingerprint text NOT NULL,
 recipient_count integer NOT NULL CHECK(recipient_count>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(creator_user_id,request_id)
);
CREATE INDEX event_invitation_page_usage ON public.event_invitation_sends(page_id,created_at);
CREATE TABLE public.event_invitation_notifications (
 invitation_id uuid NOT NULL REFERENCES public.event_invitation_sends(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id), notification_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(invitation_id,user_id)
);
ALTER TABLE public.event_invitation_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_invitation_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_invitation_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_invitation_policy,public.event_invitation_sends,public.event_invitation_notifications FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.event_invitation_context(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events; p public.creator_page_publications;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Invitation access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id;
 SELECT * INTO p FROM public.creator_page_publications WHERE page_id=public.creator_event_page_id(p_event_id);
 IF e.id IS NULL OR p.page_id IS NULL OR NOT coalesce(public.is_ticketing_organizer(e.id,auth.uid()),false)
 OR NOT coalesce(p.owner_id=auth.uid() OR (p.page_kind='community' AND public.is_community_leader(p.page_id,auth.uid())),false) THEN
  RAISE EXCEPTION 'Invitation access denied' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('eventId',e.id,'eventTitle',e.title,'eventImage',e.image_url,'eventStatus',e.status,
 'pageId',p.page_id,'pageName',p.name,'pageKind',p.page_kind,'pageAudience',p.audience,
 'startsAt',coalesce(e.start_time,e.event_date::timestamp AT TIME ZONE e.timezone),
 'endsAt',coalesce(e.end_time,e.start_time,(e.event_date+1)::timestamp AT TIME ZONE e.timezone));
END$$;
CREATE FUNCTION public.event_invitation_payload(p_message jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_message IS NULL OR jsonb_typeof(p_message)<>'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(p_message) k WHERE k NOT IN ('audience','body'))
 OR jsonb_typeof(p_message->'audience') IS DISTINCT FROM 'string'
 OR coalesce(p_message->>'audience','') NOT IN ('past_attendees','followers','community_members')
 OR jsonb_typeof(p_message->'body') IS DISTINCT FROM 'string'
 OR btrim(p_message->>'body')='' OR char_length(btrim(p_message->>'body'))>2000 THEN
 RAISE EXCEPTION 'Invalid invitation'; END IF;
 RETURN jsonb_build_object('audience',p_message->>'audience','body',btrim(p_message->>'body'));
END$$;
CREATE FUNCTION public.event_invitation_audience(p_event_id uuid,p_source text)
RETURNS TABLE(user_id uuid,excluded boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; v_page_id uuid; v_audience text;
BEGIN
 context:=public.event_invitation_context(p_event_id);
 v_page_id:=(context->>'pageId')::uuid;v_audience:=context->>'pageAudience';
 IF p_source IS NULL OR NOT (p_source='past_attendees' OR p_source=CASE WHEN context->>'pageKind'='organization' THEN 'followers' ELSE 'community_members' END) THEN
 RAISE EXCEPTION 'Invalid page invitation audience'; END IF;
 RETURN QUERY
  WITH past_events AS (
   SELECT x.id FROM public.explore_events x WHERE x.id<>p_event_id
    AND public.creator_event_page_id(x.id)=v_page_id AND x.status IN ('Live','Completed')
    AND coalesce(x.end_time,x.start_time,(x.event_date+1)::timestamp AT TIME ZONE x.timezone)<now()
  ), candidates AS (
   SELECT o.buyer_user_id AS user_id FROM public.ticket_orders o JOIN past_events x ON x.id=o.event_id
    WHERE p_source='past_attendees' AND o.status='paid' AND o.buyer_user_id IS NOT NULL
   UNION SELECT r.user_id FROM public.explore_event_rsvps r JOIN past_events x ON x.id=r.explore_event_id
    WHERE p_source='past_attendees' AND r.status='going'
   UNION SELECT f.user_id FROM public.creator_page_follow_states f
    WHERE p_source='followers' AND f.page_id=v_page_id AND f.following
   UNION SELECT m.user_id FROM public.community_members m
    WHERE p_source='community_members' AND m.community_id=v_page_id AND m.status='active'
  ), checked AS (
   SELECT c.user_id,
    EXISTS(SELECT FROM public.ticket_orders o WHERE o.event_id=p_event_id AND o.buyer_user_id=c.user_id AND o.status='paid')
    OR EXISTS(SELECT FROM public.explore_event_rsvps r WHERE r.explore_event_id=p_event_id AND r.user_id=c.user_id AND r.status='going') AS already_going,
    c.user_id=auth.uid() OR public.yours_is_blocked_between(auth.uid(),c.user_id)
    OR NOT coalesce(public.creator_page_audience_matches(v_audience,c.user_id),false)
    OR EXISTS(SELECT FROM public.attendee_message_opt_outs o WHERE o.event_id=p_event_id AND o.user_id=c.user_id) AS excluded
   FROM candidates c
  ) SELECT c.user_id,c.already_going OR c.excluded FROM checked c;
END$$;
-- Existing count-only entry point and shape retained; shared resolver prevents send/preview drift.
CREATE OR REPLACE FUNCTION public.preview_event_invitation(p_event_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; audience text; options jsonb:='[]'; counts jsonb;
BEGIN
 context:=public.event_invitation_context(p_event_id);
 FOREACH audience IN ARRAY ARRAY['past_attendees',CASE WHEN context->>'pageKind'='organization' THEN 'followers' ELSE 'community_members' END] LOOP
 SELECT jsonb_build_object('type',audience,'sourceCount',count(*),'excludedCount',count(*) FILTER(WHERE a.excluded),'eligibleCount',count(*) FILTER(WHERE NOT a.excluded))
 INTO counts FROM public.event_invitation_audience(p_event_id,audience) a;
 options:=options||jsonb_build_array(counts);
 END LOOP;
 RETURN (context-'pageAudience'-'startsAt'-'endsAt')||jsonb_build_object('audiences',options,'deliveryReady',false);
END$$;
CREATE FUNCTION public.event_invitation_recipients(p_event_id uuid,p_source text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(array_agg(a.user_id ORDER BY a.user_id),'{}'::uuid[]) FROM public.event_invitation_audience(p_event_id,p_source) a
 WHERE NOT a.excluded AND NOT EXISTS(SELECT FROM public.community_members m
 WHERE m.community_id=public.creator_event_page_id(p_event_id) AND m.user_id=a.user_id AND m.broadcasts_muted);
$$;
CREATE FUNCTION public.event_invitation_review_hash(p_context jsonb,p_payload jsonb,p_recipients uuid[]) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT encode(extensions.digest(jsonb_build_object('creator',auth.uid(),'context',p_context,'message',p_payload,'recipients',p_recipients)::text,'sha256'),'hex');
$$;
CREATE FUNCTION public.review_event_invitation(p_event_id uuid,p_message jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; payload jsonb; recipients uuid[]; policy public.event_invitation_policy;
BEGIN
 context:=public.event_invitation_context(p_event_id);payload:=public.event_invitation_payload(p_message);
 recipients:=public.event_invitation_recipients(p_event_id,payload->>'audience');
 SELECT * INTO policy FROM public.event_invitation_policy WHERE singleton;
 RETURN jsonb_build_object('context',context-'pageAudience'-'startsAt'-'endsAt','message',payload,
 'recipientCount',cardinality(recipients),'reviewHash',public.event_invitation_review_hash(context,payload,recipients),
 'channel','in_app_push','providerDeliveryConfirmed',false,'sendingEnabled',coalesce(policy.enabled,false));
END$$;
CREATE FUNCTION public.get_event_invitation_receipt(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.event_invitation_sends; queued integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Invitation access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM public.event_invitation_sends WHERE creator_user_id=auth.uid() AND request_id=p_request_id;
 IF m.id IS NULL THEN RETURN NULL; END IF;
 -- Retain own result after deletion/revocation without exposing any recipient identity or new page data.
 SELECT count(*) INTO queued FROM public.event_invitation_notifications WHERE invitation_id=m.id;
 RETURN jsonb_build_object('id',m.id,'eventId',m.event_id,'pageId',m.page_id,'requestId',m.request_id,
 'recipientCount',m.recipient_count,'pushQueuedCount',queued,'deliveryStatus','queued',
 'createdAt',m.created_at,'providerDeliveryConfirmed',false);
END$$;
CREATE FUNCTION public.submit_event_invitation(p_event_id uuid,p_request_id uuid,p_message jsonb,p_review_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; payload jsonb; recipients uuid[]; submission text; m public.event_invitation_sends;
 policy public.event_invitation_policy; page uuid; period_start timestamptz; recipient uuid; notification uuid; invitation uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Invitation access denied' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'A stable invitation request is required'; END IF;
 payload:=public.event_invitation_payload(p_message);
 submission:=public.event_invitation_review_hash(jsonb_build_object('eventId',p_event_id),payload,'{}'::uuid[]);
 PERFORM pg_advisory_xact_lock(hashtextextended('invitation:'||auth.uid()::text||':'||p_request_id::text,0));
 SELECT * INTO m FROM public.event_invitation_sends WHERE creator_user_id=auth.uid() AND request_id=p_request_id;
 IF m.id IS NOT NULL THEN
 IF m.event_id IS DISTINCT FROM p_event_id OR m.submission_fingerprint IS DISTINCT FROM submission THEN RAISE EXCEPTION 'Invitation request already belongs to another message'; END IF;
 RETURN public.get_event_invitation_receipt(p_request_id);
 END IF;
 context:=public.event_invitation_context(p_event_id);page:=(context->>'pageId')::uuid;
 -- Serialize every page creator and event against the same allowance.
 PERFORM pg_advisory_xact_lock(hashtextextended('invitation-page:'||page::text,0));
 PERFORM 1 FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 context:=public.event_invitation_context(p_event_id);
 IF (context->>'pageId')::uuid IS DISTINCT FROM page THEN RAISE EXCEPTION 'Invitation page changed; review again'; END IF;
 SELECT * INTO policy FROM public.event_invitation_policy WHERE singleton FOR SHARE;
 IF NOT coalesce(policy.enabled,false) THEN RAISE EXCEPTION 'Invitation sending is unavailable'; END IF;
 IF context->>'eventStatus' IS DISTINCT FROM 'Live' OR (context->>'endsAt') IS NULL OR (context->>'endsAt')::timestamptz<=now() THEN RAISE EXCEPTION 'Publish an upcoming event before inviting people'; END IF;
 recipients:=public.event_invitation_recipients(p_event_id,payload->>'audience');
 IF cardinality(recipients)=0 THEN RAISE EXCEPTION 'No recipients match this invitation'; END IF;
 IF p_review_hash IS NULL OR public.event_invitation_review_hash(context,payload,recipients) IS DISTINCT FROM p_review_hash THEN RAISE EXCEPTION 'Invitation or audience changed; review again'; END IF;
 period_start:=date_trunc(policy.period,now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles';
 IF (SELECT count(*) FROM public.event_invitation_sends WHERE page_id=page AND created_at>=period_start)>=policy.maximum THEN RAISE EXCEPTION 'Page invitation limit reached'; END IF;
 INSERT INTO public.event_invitation_sends(event_id,page_id,creator_user_id,request_id,audience,body,event_title,page_name,review_fingerprint,submission_fingerprint,recipient_count)
 VALUES(p_event_id,page,auth.uid(),p_request_id,payload->>'audience',payload->>'body',context->>'eventTitle',context->>'pageName',p_review_hash,submission,cardinality(recipients)) RETURNING id INTO invitation;
 FOREACH recipient IN ARRAY recipients LOOP
 notification:=gen_random_uuid();
 INSERT INTO public.app_notifications(id,user_id,type,title,body,explore_event_id,actor_user_id,status,push_sent,push_suppressed)
 VALUES(notification,recipient,'broadcast',(context->>'pageName')||' invites you to '||(context->>'eventTitle'),payload->>'body',p_event_id,auth.uid(),'unread',false,false);
 INSERT INTO public.event_invitation_notifications(invitation_id,user_id,notification_id) VALUES(invitation,recipient,notification);
 END LOOP;
 RETURN public.get_event_invitation_receipt(p_request_id);
END$$;
REVOKE ALL ON FUNCTION public.event_invitation_context(uuid),public.event_invitation_payload(jsonb),public.event_invitation_audience(uuid,text),public.event_invitation_recipients(uuid,text),public.event_invitation_review_hash(jsonb,jsonb,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.review_event_invitation(uuid,jsonb),public.get_event_invitation_receipt(uuid),public.submit_event_invitation(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.review_event_invitation(uuid,jsonb),public.get_event_invitation_receipt(uuid),public.submit_event_invitation(uuid,uuid,jsonb,text) TO authenticated;
COMMENT ON TABLE public.event_invitation_policy IS 'Unconfigured and disabled until founder invitation policy is settled and release checks pass. Provider delivery and SMS budget are separate.';
COMMENT ON TABLE public.event_invitation_sends IS 'Atomic page-scoped promotional invitation receipts. Queued is not delivered; no registration, ticket or Plan is created.';
COMMIT;
