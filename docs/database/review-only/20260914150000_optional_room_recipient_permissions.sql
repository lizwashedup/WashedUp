-- REVIEW ONLY. Verified optional-room admission and notification recipient corrections.
-- Requires local room identity/provenance and creator publication candidates.
-- No backfill, new membership/read state, provider send or production authorization.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.notify_new_topic_message()'::regprocedure)) <> 'd2c0786b81e75edef260d0f158207048' THEN RAISE EXCEPTION 'Unexpected notify_new_topic_message definition; reconcile before applying'; END IF;
 IF md5(pg_get_functiondef('public.claim_pending_push_notifications(uuid[],integer)'::regprocedure)) <> 'd3076260a7536ad5f2e964eb9b9d4a65' THEN RAISE EXCEPTION 'Unexpected claim_pending_push_notifications definition; reconcile before applying'; END IF;
END $guard$;
-- Additive restriction: an event whose FK was cleared is still attendance-scoped.
CREATE POLICY community_topic_no_former_event_join ON public.community_topic_members
 AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (EXISTS(SELECT 1 FROM public.community_topics t WHERE t.id=community_topic_members.topic_id AND t.original_event_id IS NULL));

-- Private caller-independent recipient evaluation. Never use auth.uid() to
-- evaluate someone else's membership/audience from a sender or service context.
CREATE FUNCTION public.community_topic_notice_recipient_allowed(p_topic_id uuid,p_user_id uuid,p_sender_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_user_id IS NOT NULL AND p_sender_id IS NOT NULL AND p_user_id<>p_sender_id
 AND NOT public.yours_is_blocked_between(p_user_id,p_sender_id)
 AND EXISTS(
  SELECT 1 FROM public.community_topics t
  JOIN public.community_topic_members tm ON tm.topic_id=t.id AND tm.user_id=p_user_id AND tm.notifications_on
  JOIN public.communities c ON c.id=t.community_id
  LEFT JOIN public.creator_page_publications pub ON pub.page_id=c.id
  WHERE t.id=p_topic_id AND NOT t.archived
   AND (NOT EXISTS(SELECT 1 FROM public.creator_page_drafts WHERE id=c.id)
        AND pub.page_id IS NULL
        OR pub.page_id IS NOT NULL AND c.status='active' AND public.creator_page_audience_matches(pub.audience,p_user_id))
   AND CASE WHEN t.original_event_id IS NULL AND t.explore_event_id IS NULL THEN
    c.status='active' AND EXISTS(SELECT 1 FROM public.community_members cm WHERE cm.community_id=c.id AND cm.user_id=p_user_id AND cm.status='active')
   ELSE
    -- Keep attendance-owned topic membership; never require community joining.
    -- A removed source event cannot turn into a persistent group or send notices.
    EXISTS(SELECT 1 FROM public.explore_events e WHERE e.id=t.explore_event_id AND e.status='Live'
     AND (coalesce(e.end_time,e.start_time,e.event_date::timestamptz) IS NULL
          OR now()<coalesce(e.end_time,e.start_time,e.event_date::timestamptz)+interval '48 hours'))
   END
 );
$$;
REVOKE ALL ON FUNCTION public.community_topic_notice_recipient_allowed(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.notify_new_topic_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sender_name text;
  v_topic_name  text;
  v_body        text;
  v_member_row  RECORD;
  v_recent      boolean;
BEGIN
  SELECT first_name_display INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT name INTO v_topic_name FROM public.community_topics WHERE id = NEW.topic_id;

  v_body := CASE
    WHEN length(NEW.body) > 120 THEN left(NEW.body, 117) || '...'
    ELSE NEW.body
  END;

  FOR v_member_row IN
    SELECT ctm.user_id
    FROM public.community_topic_members ctm
    WHERE ctm.topic_id = NEW.topic_id
      AND ctm.notifications_on = true
      AND ctm.user_id <> NEW.sender_id
      AND public.community_topic_notice_recipient_allowed(NEW.topic_id,ctm.user_id,NEW.sender_id)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.app_notifications
      WHERE user_id = v_member_row.user_id
        AND topic_id = NEW.topic_id
        AND type = 'new_message'
        AND status = 'unread'
        AND created_at > now() - interval '30 seconds'
    ) INTO v_recent;

    IF NOT v_recent THEN
      INSERT INTO public.app_notifications (user_id, type, title, body, topic_id, actor_user_id)
      VALUES (
        v_member_row.user_id,
        'new_message',
        COALESCE(v_sender_name, 'Someone') || ' in ' || COALESCE(v_topic_name, 'a room'),
        v_body,
        NEW.topic_id,
        NEW.sender_id
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_pending_push_notifications(p_token_user_ids uuid[], p_batch_size integer DEFAULT 100)
 RETURNS TABLE(id uuid, user_id uuid, type text, title text, body text, event_id uuid, circle_id uuid, topic_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Re-evaluate queued topic recipients at claim time. Keep original rows and
  -- the claim protocol; never revive a suppressed row on rejoin/unmute.
  update public.app_notifications as pending
  set push_suppressed = true
  where pending.id in (
    select notice.id from public.app_notifications notice
    where not notice.push_sent and not notice.push_suppressed and notice.status='unread'
      and notice.type='new_message' and notice.topic_id is not null
      and notice.user_id=any(p_token_user_ids)
      and not public.community_topic_notice_recipient_allowed(notice.topic_id,notice.user_id,notice.actor_user_id)
    for update of notice skip locked
  );
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
NOTIFY pgrst, 'reload schema';
COMMIT;
