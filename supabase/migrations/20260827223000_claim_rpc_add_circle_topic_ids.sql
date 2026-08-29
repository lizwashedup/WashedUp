-- Teach claim_pending_push_notifications to also return circle_id and
-- topic_id, so the edge function (and the client tap router) can actually
-- see which chat surface a notification belongs to.
--
-- REVIEW ONLY. NOT applied by the agent.
--
-- Context: confirmed 2026-08-27 that neither circle_id (added by
-- 20260605000200_circle_message_push.sql, itself unapplied) nor topic_id
-- (added by 20260827220000_community_topic_message_push.sql, also
-- unapplied) are selected by this RPC's RETURNS TABLE or its final
-- RETURNING clause -- both are silently dropped before the edge function
-- ever sees them, on top of the edge function itself not building a
-- circleId/topicId payload field. This migration is the middle of that
-- three-piece chain (RPC -> edge function -> client tap router). Apply all
-- three together, or notifications keep either not firing or firing with no
-- working tap target.
--
-- Purely additive: two new output columns, both nullable, no change to the
-- suppression or claim-filter logic in either statement. Every existing row
-- type (plan chat, album, waitlist, invites, etc.) just gets circle_id=NULL,
-- topic_id=NULL, same as today.
--
-- Idempotent; wrapped in a self-test.

BEGIN;

-- Postgres refuses CREATE OR REPLACE when the return type changes (error
-- 42P13, hit live 2026-08-27 running this exact migration) -- DROP first,
-- inside this same transaction, so the function is never missing to a live
-- caller. The DROP+CREATE pair is atomic inside BEGIN/COMMIT: a concurrent
-- caller sees either the old version or the new one, never neither.
drop function if exists public.claim_pending_push_notifications(uuid[], integer);

create or replace function public.claim_pending_push_notifications(
  p_token_user_ids uuid[],
  p_batch_size integer default 100
)
returns table(id uuid, user_id uuid, type text, title text, body text, event_id uuid, circle_id uuid, topic_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Suppress new_message pushes for users currently viewing the exact
  -- chat. Unchanged from the prior version: still keyed on event_id only,
  -- circle/topic active-viewing suppression is a separate, not-yet-built
  -- feature, out of scope here.
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
  -- SKIP LOCKED dedup pattern as before; only the returned column list
  -- changed.
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
  returning upd2.id, upd2.user_id, upd2.type, upd2.title, upd2.body, upd2.event_id, upd2.circle_id, upd2.topic_id;
end;
$function$;

-- DROP discards the function's ACL (same trap already documented in
-- 20260814140000_begin_ticket_checkout_v2.sql for begin_ticket_checkout).
-- Re-assert it explicitly rather than trust default privileges: this is a
-- SECURITY DEFINER function that claims/mutates notification rows and must
-- stay service_role-only, never anon/authenticated-callable.
alter function public.claim_pending_push_notifications(uuid[], integer) owner to postgres;
revoke all on function public.claim_pending_push_notifications(uuid[], integer) from public, anon, authenticated;
grant execute on function public.claim_pending_push_notifications(uuid[], integer) to service_role;

-- ---------------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_return_type text;
BEGIN
  SELECT pg_get_function_result(oid) INTO v_return_type
  FROM pg_proc WHERE proname = 'claim_pending_push_notifications';
  IF v_return_type NOT LIKE '%circle_id%' OR v_return_type NOT LIKE '%topic_id%' THEN
    RAISE EXCEPTION 'claim_pending_push_notifications did not pick up circle_id/topic_id in its return type';
  END IF;
END $$;

COMMIT;
