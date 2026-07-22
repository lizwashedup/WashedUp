-- ============================================================================
-- 21: THE OPEN COMPOSER — free member messages in the main community chat
-- Cowork APPROVED 7-08 clean, no fixes. Applied on Liz's go as
-- supabase/migrations/20260708220000_open_composer.sql, self-tests intact.
-- Dry-run passed first try inside begin/rollback against prod.
--
-- Why (Liz 7-08, gates giving the app to Kristen): the locked doc 09 model
-- makes the main community chat a fully open member conversation —
-- announcements and intro cards are special highlighted rows INSIDE the
-- thread, members talk freely with a normal composer. Today
-- community_broadcasts is leader-insert-only, so members can only react and
-- reply under broadcasts. This batch opens the thread.
--
-- WHY THIS SHAPE (the cleanest path): the main thread already IS one stream —
-- community_broadcasts, which batch 19 gave a kind column. Adding
-- kind='message' with a member-insert policy puts announcements ('broadcast'),
-- intro cards ('intro'), and member talk ('message') in ONE ordered stream.
-- Verified against live prod before writing: the cards RPC's unread counts
-- and latest-activity ordering read ALL community_broadcasts rows regardless
-- of kind, and the table is already in the realtime publication — so unreads,
-- list ordering, previews, and live inserts inherit with ZERO changes there.
-- No new table, no new read model, no parallel plumbing.
--
-- DELIBERATE CALLS (accept or push back):
-- a. QUIET MESSAGES: the fan-out trigger skips kind='message' (as it skips
--    intros). Member chat does NOT push-notify every member per message —
--    matching the rooms, which have never pushed per-message. Unread badges
--    carry the signal. A per-message notification story is a later,
--    deliberate pass (bells like the rooms have), not a side effect here.
-- b. SEPARATE POLICY, NOT A WIDENED ONE (house rule): the existing
--    leader-only insert policy stays untouched; members get their own policy
--    pinned to kind='message' + sender self + active membership. A member
--    can NOT insert 'broadcast' or 'intro' rows (self-tested).
-- c. ACCEPTED RESIDUAL, unchanged from today: the leader insert policy does
--    not constrain kind, so a leader could hand-craft an 'intro' row via
--    direct insert. Leaders already speak as the community; noted, not
--    worth a policy rewrite in this batch.
-- d. MESSAGE LENGTH: new CHECK caps kind='message' bodies at 4000 chars
--    (matching the rooms' client cap). Broadcasts/intros keep their existing
--    latitude; all existing rows pass by construction.
-- e. MODERATION: delete stays leader/admin (existing delete policy) — a
--    leader can remove any message in their community's thread. Member
--    self-delete/edit is a later conversation with the moderation plan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. the third kind + the message length cap (superset recreate, call d)
-- ----------------------------------------------------------------------------
alter table public.community_broadcasts
  drop constraint community_broadcasts_kind_check;
alter table public.community_broadcasts
  add constraint community_broadcasts_kind_check
    check (kind in ('broadcast', 'intro', 'message'));

alter table public.community_broadcasts
  add constraint community_broadcasts_message_len
    check (kind <> 'message' or char_length(body) <= 4000);

-- ----------------------------------------------------------------------------
-- 2. members may speak (new separate policy, call b)
-- ----------------------------------------------------------------------------
create policy community_broadcasts_member_insert on public.community_broadcasts
  for insert with check (
    kind = 'message'
    and sender_id = (select auth.uid())
    and is_community_member(community_id, (select auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- 3. quiet messages (call a): the fan-out trigger skips member talk
-- ----------------------------------------------------------------------------
create or replace function public.notify_community_broadcast()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.kind in ('intro', 'message') then
    return new;  -- calls a + 19e: neither intros nor member talk push members
  end if;
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  select m.user_id,
         'community_broadcast',
         c.name,
         left(new.body, 500),
         new.sender_id
  from community_members m
  join communities c on c.id = new.community_id
  where m.community_id = new.community_id
    and m.status = 'active'
    and not m.broadcasts_muted
    and m.user_id is distinct from new.sender_id;
  return new;
end;
$function$;

-- ============================================================================
-- SELF-TESTS (in-transaction, NEVER strip on apply)
-- ============================================================================
do $selftest$
declare
  v_leader uuid;
  v_member uuid;
  v_outsider uuid;
  v_cid uuid;
  v_mid uuid;
  v_msg uuid;
  v_n int;
  v_cards jsonb;
begin
  select u.id into v_leader from auth.users u
  where not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  select u.id into v_member from auth.users u
  where u.id <> v_leader
    and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  select u.id into v_outsider from auth.users u
  where u.id not in (v_leader, v_member)
    and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  if v_leader is null or v_member is null or v_outsider is null then
    raise exception 'selftest: need 3 non-admin users';
  end if;

  insert into communities (name, handle, status, created_by)
  values ('selftest open chat club', 'selftest-open-chat-21', 'active', v_leader)
  returning id into v_cid;
  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_leader, 'leader', 'active', now() - interval '2 hours');
  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_member, 'member', 'active', now() - interval '1 hour')
  returning id into v_mid;

  -- 1. a plain member speaks in the main chat through RLS
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into community_broadcasts (community_id, sender_id, body, kind)
  values (v_cid, v_member, 'selftest member message 21', 'message')
  returning id into v_msg;
  reset role;
  if v_msg is null then
    raise exception 'selftest: member message insert failed';
  end if;

  -- 2. a member can NOT broadcast (kind pinned by the member policy)
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into community_broadcasts (community_id, sender_id, body, kind)
    values (v_cid, v_member, 'selftest forged broadcast 21', 'broadcast');
    reset role;
    raise exception 'selftest: member inserted a broadcast';
  exception when insufficient_privilege then
    reset role;
  end;

  -- 3. a non-member can not speak
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into community_broadcasts (community_id, sender_id, body, kind)
    values (v_cid, v_outsider, 'selftest outsider message 21', 'message');
    reset role;
    raise exception 'selftest: outsider spoke in the chat';
  exception when insufficient_privilege then
    reset role;
  end;

  -- 4. quiet messages: no fan-out for the member message
  select count(*) into v_n from app_notifications
  where type = 'community_broadcast' and body = 'selftest member message 21';
  if v_n <> 0 then
    raise exception 'selftest: member message pushed members';
  end if;

  -- 5. a real broadcast still fans out (regression)
  insert into community_broadcasts (community_id, sender_id, body)
  values (v_cid, v_leader, 'selftest broadcast 21');
  select count(*) into v_n from app_notifications
  where type = 'community_broadcast' and body = 'selftest broadcast 21'
    and user_id = v_member;
  if v_n <> 1 then
    raise exception 'selftest: broadcast fan-out broken';
  end if;

  -- 6. the message length cap holds
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into community_broadcasts (community_id, sender_id, body, kind)
    values (v_cid, v_member, repeat('x', 4001), 'message');
    reset role;
    raise exception 'selftest: oversize message accepted';
  exception when check_violation then
    reset role;
  end;

  -- 7. the leader's unread badge counts the member message (inheritance probe)
  perform set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_cards := get_my_community_chat_cards();
  reset role;
  select (card->>'unread_broadcasts')::int into v_n
  from jsonb_array_elements(v_cards->'cards') card
  where card->>'community_id' = v_cid::text;
  if coalesce(v_n, 0) < 1 then
    raise exception 'selftest: member message not counted unread for the leader';
  end if;

  -- cleanup (fixture rows only)
  delete from app_notifications where type = 'community_broadcast'
    and body in ('selftest broadcast 21', 'selftest member message 21');
  delete from community_broadcasts where community_id = v_cid;
  delete from community_members where community_id = v_cid;
  delete from communities where id = v_cid;

  raise notice 'selftest 21: ALL PASSED';
end;
$selftest$;
