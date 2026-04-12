-- ══════════════════════════════════════════════════════════════════════
-- Push up active-chat suppression into claim_pending_push_notifications
--
-- Context: 20260412000000_suppress_active_chat_pushes.sql added
-- profiles.active_chat_event_id and app_notifications.push_suppressed,
-- but the live send-push edge function calls this RPC (not the pre-RPC
-- code in git) and this RPC doesn't know about either column yet.
--
-- New behaviour:
--   1. First statement: mark new_message notifications push_suppressed
--      when the target user's active_chat_event_id matches the event.
--      These never get claimed for delivery, now or on any future run
--      (the flag is sticky and filtered out below).
--   2. Second statement: same FOR UPDATE SKIP LOCKED atomic claim as
--      before for everything else, plus a push_suppressed=false filter
--      so the suppression pass never leaks into the outbound batch.
--
-- Both statements live inside one plpgsql function body, which the
-- trigger calls in a single transaction, so parallel invocations still
-- grab disjoint row sets via SKIP LOCKED and no message can be
-- double-pushed.
-- ══════════════════════════════════════════════════════════════════════

create or replace function public.claim_pending_push_notifications(
  p_token_user_ids uuid[],
  p_batch_size integer default 100
)
returns table(id uuid, user_id uuid, type text, title text, body text, event_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Suppress new_message pushes for users currently viewing the exact
  -- chat. They're watching messages arrive live via Supabase realtime;
  -- a banner + haptic for a message already on screen is noise. Mark
  -- push_suppressed=true so the row still counts as an unread inbox
  -- item but never ships to Expo.
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

  -- Atomic claim of the remaining deliverable rows. Same FOR UPDATE
  -- SKIP LOCKED dedup pattern as the original version so concurrent
  -- trigger invocations grab disjoint sets. The push_suppressed=false
  -- filter keeps suppressed rows from leaking back in.
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
    order by m.created_at
    limit p_batch_size
    for update of m skip locked
  )
  returning upd2.id, upd2.user_id, upd2.type, upd2.title, upd2.body, upd2.event_id;
end;
$function$;
