-- REVIEW ONLY. Capture exact community chat notification provenance before
-- enabling whole-community mute. Preserve legacy source-less announcements
-- during capture; a separate activation guard must verify their transition.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.claim_pending_push_notifications(uuid[],integer)'::regprocedure))<>'dcc343c2fb86e4f1b7c8756b786d9da3' THEN RAISE EXCEPTION 'Unexpected claim_pending_push_notifications definition'; END IF;
 IF md5(pg_get_functiondef('public.claim_push_notifications(uuid[],integer)'::regprocedure))<>'ef5e7daa1a9453bf139bc0e32b79e132' THEN RAISE EXCEPTION 'Unexpected claim_push_notifications definition'; END IF;
 IF md5(pg_get_functiondef('public.notify_community_broadcast()'::regprocedure))<>'a6cd7ebe3651c755c49874a1c613c2e9' THEN RAISE EXCEPTION 'Unexpected notify_community_broadcast definition'; END IF;
END $guard$;
CREATE TABLE public.community_chat_notification_targets (
 notification_id uuid PRIMARY KEY REFERENCES public.app_notifications(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 source_kind text NOT NULL CHECK(source_kind IN ('topic','broadcast')),
 community_id uuid NOT NULL,
 topic_id uuid,
 broadcast_id uuid,
 sender_id uuid NOT NULL,
 suppressed_at timestamptz,
 CHECK((source_kind='topic' AND topic_id IS NOT NULL AND broadcast_id IS NULL)
    OR (source_kind='broadcast' AND broadcast_id IS NOT NULL AND topic_id IS NULL))
);
-- Preserve source identifiers while their notification exists. Original
-- notification/account cascades, including topic deletion, remain unchanged.
ALTER TABLE public.community_chat_notification_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_chat_notification_targets FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX community_chat_notification_target_recipient ON public.community_chat_notification_targets(community_id,user_id);
CREATE FUNCTION public.community_chat_sources_required() RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.community_chat_sources_required() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.community_announcement_recipient_allowed(p_community_id uuid,p_user_id uuid,p_sender_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_user_id IS NOT NULL AND p_sender_id IS NOT NULL AND p_user_id<>p_sender_id
 AND NOT public.yours_is_blocked_between(p_user_id,p_sender_id)
 AND EXISTS(SELECT 1 FROM public.communities c
  JOIN public.community_members m ON m.community_id=c.id AND m.user_id=p_user_id AND m.status='active' AND NOT m.broadcasts_muted
  LEFT JOIN public.creator_page_publications p ON p.page_id=c.id
  WHERE c.id=p_community_id AND c.status='active'
   AND (p.page_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.creator_page_drafts WHERE id=c.id)
     OR p.page_id IS NOT NULL AND public.creator_page_audience_matches(p.audience,p_user_id)));
$$;
REVOKE ALL ON FUNCTION public.community_announcement_recipient_allowed(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.capture_community_topic_notification_target() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.type='new_message' AND NEW.topic_id IS NOT NULL AND NEW.actor_user_id IS NOT NULL THEN
  INSERT INTO public.community_chat_notification_targets(notification_id,user_id,source_kind,community_id,topic_id,sender_id)
  SELECT NEW.id,NEW.user_id,'topic',t.community_id,t.id,NEW.actor_user_id FROM public.community_topics t WHERE t.id=NEW.topic_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_community_topic_notification_target() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_community_topic_notification_target AFTER INSERT ON public.app_notifications
 FOR EACH ROW EXECUTE FUNCTION public.capture_community_topic_notification_target();
-- Existing topics have explicit source/actor fields, unlike legacy announcements.
INSERT INTO public.community_chat_notification_targets(notification_id,user_id,source_kind,community_id,topic_id,sender_id,suppressed_at)
 SELECT n.id,n.user_id,'topic',t.community_id,t.id,n.actor_user_id,CASE WHEN n.push_suppressed THEN now() ELSE NULL END
 FROM public.app_notifications n JOIN public.community_topics t ON t.id=n.topic_id
 WHERE n.type='new_message' AND n.actor_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_community_broadcast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
 IF NEW.kind IN ('intro','message') THEN RETURN NEW; END IF;
 WITH notices AS (
  INSERT INTO public.app_notifications(user_id,type,title,body,actor_user_id)
  SELECT m.user_id,'community_broadcast',c.name,left(NEW.body,500),NEW.sender_id
  FROM public.community_members m JOIN public.communities c ON c.id=m.community_id
  WHERE m.community_id=NEW.community_id
   AND public.community_announcement_recipient_allowed(NEW.community_id,m.user_id,NEW.sender_id)
  RETURNING id,user_id
 ) INSERT INTO public.community_chat_notification_targets(notification_id,user_id,source_kind,community_id,broadcast_id,sender_id)
 SELECT id,user_id,'broadcast',NEW.community_id,NEW.id,NEW.sender_id FROM notices;
 RETURN NEW;
END $$;

CREATE FUNCTION public.community_chat_notice_is_eligible(p_notification_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.app_notifications; t public.community_chat_notification_targets;
BEGIN
 SELECT * INTO n FROM public.app_notifications WHERE id=p_notification_id;
 IF NOT FOUND OR n.status<>'unread' OR n.push_suppressed OR n.created_at<=now()-interval '72 hours'
  OR n.expires_at IS NOT NULL AND n.expires_at<=now() THEN RETURN false; END IF;
 SELECT * INTO t FROM public.community_chat_notification_targets original WHERE original.notification_id=n.id;
 IF NOT FOUND THEN
  IF n.type='community_broadcast' THEN RETURN NOT public.community_chat_sources_required(); END IF;
  IF n.type='new_message' AND n.topic_id IS NOT NULL THEN
   RETURN public.community_topic_notice_recipient_allowed(n.topic_id,n.user_id,n.actor_user_id);
  END IF;
  RETURN true;
 END IF;
 IF t.suppressed_at IS NOT NULL OR n.user_id IS DISTINCT FROM t.user_id OR n.actor_user_id IS DISTINCT FROM t.sender_id
  OR n.event_id IS NOT NULL OR n.circle_id IS NOT NULL THEN RETURN false; END IF;
 IF t.source_kind='topic' THEN
  RETURN n.type='new_message' AND n.topic_id IS NOT DISTINCT FROM t.topic_id
   AND EXISTS(SELECT 1 FROM public.community_topics WHERE id=t.topic_id AND community_id=t.community_id)
   AND public.community_topic_notice_recipient_allowed(t.topic_id,t.user_id,t.sender_id);
 END IF;
 RETURN n.type='community_broadcast' AND n.topic_id IS NULL
  AND EXISTS(SELECT 1 FROM public.community_broadcasts b WHERE b.id=t.broadcast_id AND b.community_id=t.community_id AND b.sender_id=t.sender_id AND b.kind='broadcast')
  AND public.community_announcement_recipient_allowed(t.community_id,t.user_id,t.sender_id);
END $$;
REVOKE ALL ON FUNCTION public.community_chat_notice_is_eligible(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_community_chat_push_targets(p_notification_ids uuid[]) RETURNS TABLE(
 notification_id uuid,user_id uuid,source_kind text,community_id uuid,topic_id uuid,broadcast_id uuid,eligible boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Deterministic lock order. A confirmed denial remains terminal even if the
 -- recipient later unmutes/rejoins/unblocks or edits an own notification row.
 PERFORM 1 FROM public.app_notifications n WHERE n.id=ANY(p_notification_ids) ORDER BY n.id FOR UPDATE;
 UPDATE public.community_chat_notification_targets t SET suppressed_at=coalesce(t.suppressed_at,now())
 WHERE t.notification_id=ANY(p_notification_ids) AND NOT public.community_chat_notice_is_eligible(t.notification_id);
 UPDATE public.app_notifications n SET push_suppressed=true
 WHERE n.id=ANY(p_notification_ids)
  AND (n.type='community_broadcast' OR n.type='new_message' AND n.topic_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.community_chat_notification_targets original WHERE original.notification_id=n.id))
  AND NOT public.community_chat_notice_is_eligible(n.id);
 RETURN QUERY SELECT n.id,n.user_id,coalesce(t.source_kind,CASE WHEN n.type='community_broadcast' THEN 'legacy' ELSE 'topic' END),
  t.community_id,coalesce(t.topic_id,n.topic_id),t.broadcast_id,public.community_chat_notice_is_eligible(n.id)
 FROM public.app_notifications n LEFT JOIN public.community_chat_notification_targets t ON t.notification_id=n.id
 WHERE n.id=ANY(p_notification_ids) AND (n.type='community_broadcast' OR n.type='new_message' AND n.topic_id IS NOT NULL OR t.notification_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.get_community_chat_push_targets(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_community_chat_push_targets(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_pending_push_notifications(p_token_user_ids uuid[], p_batch_size integer DEFAULT 100)
 RETURNS TABLE(id uuid, user_id uuid, type text, title text, body text, event_id uuid, circle_id uuid, topic_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Capture a terminal rejection without altering history/read state.
  with rejected as materialized (
    select n.id from public.app_notifications n
    where not n.push_sent and not n.push_suppressed and n.status='unread' and n.user_id=any(p_token_user_ids)
     and (n.type='community_broadcast' or n.type='new_message' and n.topic_id is not null
       or exists(select 1 from public.community_chat_notification_targets original where original.notification_id=n.id))
     and not public.community_chat_notice_is_eligible(n.id)
    for update of n skip locked
  ), terminal as (
    update public.community_chat_notification_targets t set suppressed_at=coalesce(t.suppressed_at,now())
    where t.notification_id in(select r.id from rejected r) returning t.notification_id
  ) update public.app_notifications n set push_suppressed=true where n.id in(select r.id from rejected r);
  update app_notifications as upd
  set push_suppressed = true
  where upd.id in (
    select n.id
    from app_notifications n
    inner join profiles p on p.id = n.user_id
    where n.push_sent = false
      and n.push_suppressed = false
      and n.status = 'unread'
      and n.type = 'new_message'
      and n.user_id = any(p_token_user_ids)
      and p.active_chat_event_id is not null
      and p.active_chat_event_id = n.event_id
    for update of n skip locked
  );

  return query
  update app_notifications as upd2
  set push_sent = true
  where upd2.id in (
    select m.id
    from app_notifications m
    where m.push_sent = false
      and m.push_suppressed = false
      and m.status = 'unread'
      and m.user_id = any(p_token_user_ids)
      and m.created_at > now() - interval '72 hours'
    order by m.created_at
    limit p_batch_size
    for update of m skip locked
  )
  returning upd2.id, upd2.user_id, upd2.type, upd2.title, upd2.body, upd2.event_id, upd2.circle_id, upd2.topic_id;
end;
$function$
;
-- Retain the older invoker signature and RLS; close its measured suppression bypass.
CREATE OR REPLACE FUNCTION public.claim_push_notifications(p_user_ids uuid[], p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, user_id uuid, type text, title text, body text, event_id uuid)
 LANGUAGE sql
AS $function$
  UPDATE app_notifications
  SET push_sent = true
  WHERE id IN (
    SELECT id FROM app_notifications
    WHERE push_sent = false
      AND push_suppressed = false
      AND status = 'unread'
      AND user_id = ANY(p_user_ids)
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING id, user_id, type, title, body, event_id;
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
