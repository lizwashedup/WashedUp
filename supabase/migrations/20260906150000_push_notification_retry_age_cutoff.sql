-- Fix: send-push-notifications retries every unsent notification forever,
-- oldest-first, with no age cutoff. A backlog of 14,787 pending rows (some
-- from March) means every trigger invocation's 100-row batch is dominated
-- by months-old notifications whose recipients' tokens/subscriptions are
-- long dead, starving genuinely fresh notifications from ever being
-- attempted. This is why a live test batch came back 0/100 sent tonight
-- while day-by-day history shows a roughly 50% ambient success rate: the
-- claim always pulls the oldest rows first, and the backlog never shrinks
-- because a failed row just re-enters the same oldest-first queue forever.
--
-- Fix: exclude notifications older than 72 hours from ever being claimed
-- again. Anything that stale is no longer worth pushing (the underlying
-- event -- a new message, an RSVP, etc -- is long past relevant), and this
-- stops it from crowding out current notifications. The cutoff itself
-- (72h) is a product call Liz can tune later; the bug being fixed here is
-- that there was no cutoff at all. Rows older than the cutoff are left in
-- place (push_sent stays false) rather than deleted or force-marked --
-- purely inert once excluded from the claim query, safe to clean up later
-- with a separate, explicit decision.
CREATE OR REPLACE FUNCTION public.claim_pending_push_notifications(p_token_user_ids uuid[], p_batch_size integer DEFAULT 100)
 RETURNS TABLE(id uuid, user_id uuid, type text, title text, body text, event_id uuid, circle_id uuid, topic_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
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
$function$;

-- Self-test: confirm the age filter is actually present in the deployed body
-- (catches a copy-paste mistake the same way the run-token migration's own
-- self-test does).
DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'claim_pending_push_notifications') NOT LIKE '%72 hours%' THEN
    RAISE EXCEPTION 'claim_pending_push_notifications: age cutoff not found in deployed function body';
  END IF;
END $$;
