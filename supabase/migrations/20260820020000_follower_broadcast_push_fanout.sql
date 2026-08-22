-- REVIEW ONLY. Forward migration. Do not apply without explicit approval.
-- Depends on 20260818180000_follower_broadcasts_o03.sql (also unapplied as
-- of this writing) -- this migration's self-test will fail loudly if that
-- one has not landed first, since follower_broadcasts must exist.
--
-- C-15 (backlog inventory): the broadcast composer sends an in-app-only row
-- today, no real push delivery, confirmed live against follower_broadcasts'
-- own RLS-only design. Josh's ruling 2026-08-20: wire push through the
-- existing OneSignal pipeline (app_notifications -> claim_pending_push_
-- notifications -> send-push-notifications), not a new provider. Both
-- 'broadcast' and 'community_broadcast' are already valid app_notifications
-- .type values (app_notifications_type_check, confirmed live) -- no
-- constraint change needed here.
--
-- Scope: IMMEDIATE sends only. A scheduled (future visible_at) broadcast
-- still gets no push at send time -- a future cron-driven "push scheduled
-- broadcasts when visible_at passes" is explicitly NOT built here -- flagged
-- as a known follow-up gap, not a silent omission.
--
-- REVISED 2026-08-21: the paragraph above originally also said the function
-- "would push everyone at schedule-time, not at visible_at, if called for a
-- scheduled row" and relied on the client only ever calling it when
-- scheduledFor is null/now. That was a client-trust assumption, not a
-- database guarantee -- the function itself had no visible_at check, so
-- calling it directly (retry, double-tap, client bug, or just curling the
-- RPC) on a future-scheduled row fanned out its real body text to every
-- follower immediately, a day before follower_broadcasts' own RLS would
-- ever let them read it. Reproduced empirically, then fixed by adding a
-- `visible_at > now()` guard before the fan-out inserts below -- confirmed
-- the guard blocks the early case and does not affect a normal immediate
-- send.

begin;

-- ---------------------------------------------------------------------------
-- 1. the fan-out function
-- ---------------------------------------------------------------------------
create or replace function public.fanout_follower_broadcast_push(p_broadcast_id uuid)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.follower_broadcasts%rowtype;
  v_title text;
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.follower_broadcasts where id = p_broadcast_id;
  if v_row.id is null then
    raise exception 'broadcast not found';
  end if;
  -- defense in depth: the INSERT that created this row already enforced
  -- sender authorization via follower_broadcasts_insert; re-check here so
  -- this SECURITY DEFINER function never fans out push on anyone's behalf
  -- but the row's own real sender.
  if v_row.sender_user_id <> v_uid then
    raise exception 'not your broadcast';
  end if;
  -- the whole point of visible_at (this table's own RLS SELECT policy gates
  -- reads on it) is that a scheduled broadcast is invisible to followers
  -- until its time comes. This function bypasses that RLS (SECURITY
  -- DEFINER) and is directly callable by the sender at any time, so without
  -- this guard the sender could fan out a broadcast's real content to every
  -- follower a day before anyone was ever supposed to see it -- a client
  -- retry, double-tap, or bug calling this early would do it too, not just
  -- a deliberate call. Found + reproduced 2026-08-21.
  if v_row.visible_at > now() then
    raise exception 'not yet visible';
  end if;

  if v_row.organizer_user_id is not null then
    select coalesce(first_name_display, 'your organizer') into v_title
    from public.profiles_public where id = v_row.organizer_user_id;

    insert into public.app_notifications (user_id, type, title, body, actor_user_id, status, push_sent, push_suppressed)
    select f.follower_user_id, 'broadcast', v_title, v_row.body, v_uid, 'unread', false, false
    from public.organizer_follows f
    where f.organizer_user_id = v_row.organizer_user_id
      and f.follower_user_id <> v_uid;
  else
    select coalesce(name, 'your community') into v_title
    from public.communities where id = v_row.community_id;

    -- exclude the sender: joining a community auto-follows it (proposal 68's
    -- join trigger), so a leader who is a member of their own community
    -- would otherwise get pushed a notification about the broadcast they
    -- just sent themselves.
    insert into public.app_notifications (user_id, type, title, body, actor_user_id, status, push_sent, push_suppressed)
    select f.follower_user_id, 'community_broadcast', v_title, v_row.body, v_uid, 'unread', false, false
    from public.organizer_follows f
    where f.community_id = v_row.community_id
      and f.follower_user_id <> v_uid;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.fanout_follower_broadcast_push(uuid) from public;
grant execute on function public.fanout_follower_broadcast_push(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. in-transaction self-test (never strip on apply)
-- ---------------------------------------------------------------------------
do $$
declare
  v_organizer uuid;
  v_follower uuid;
  v_stranger uuid;
  v_row_id uuid;
  v_cid uuid;
  v_sent integer;
  v_notif_count integer;
  v_raised boolean;
  v_inserted_organizer_profile boolean := false;
begin
  select id into v_organizer from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_follower from auth.users u
  where u.id <> v_organizer
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_stranger from auth.users u
  where u.id not in (v_organizer, v_follower)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_organizer is null or v_follower is null or v_stranger is null then
    raise exception 'SELF-TEST FAIL: needs three existing non-admin users';
  end if;

  -- organizer_follows.organizer_user_id FK's to organizer_profiles (same
  -- gap the 8/18 follower_broadcasts self-test had, fixed there the same
  -- way): give v_organizer a temp profile row rather than assume one exists.
  insert into public.organizer_profiles (user_id, display_name)
  values (v_organizer, 'selftest-fanout-organizer')
  on conflict (user_id) do nothing
  returning true into v_inserted_organizer_profile;
  v_inserted_organizer_profile := coalesce(v_inserted_organizer_profile, false);

  insert into public.organizer_follows (follower_user_id, organizer_user_id) values (v_follower, v_organizer);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.follower_broadcasts (sender_user_id, organizer_user_id, body)
  values (v_organizer, v_organizer, 'push fanout selftest')
  returning id into v_row_id;
  reset role;

  -- a stranger cannot fan out push on someone else's broadcast
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.fanout_follower_broadcast_push(v_row_id);
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-sender could fan out push for someone else''s broadcast';
  end if;

  -- the real sender fans out; exactly 1 row (the one real follower)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.fanout_follower_broadcast_push(v_row_id) into v_sent;
  reset role;
  if v_sent <> 1 then
    raise exception 'SELF-TEST FAIL: expected 1 push fanned out, got %', v_sent;
  end if;

  select count(*) into v_notif_count from public.app_notifications
  where user_id = v_follower and type = 'broadcast' and actor_user_id = v_organizer and body = 'push fanout selftest';
  if v_notif_count <> 1 then
    raise exception 'SELF-TEST FAIL: follower did not receive exactly 1 app_notifications row';
  end if;

  -- community path
  insert into public.communities (handle, name, created_by, status)
  values ('selftest-fanout-tmp', 'fanout selftest', v_organizer, 'active')
  returning id into v_cid;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_organizer, 'leader', 'active', now());
  insert into public.organizer_follows (follower_user_id, community_id) values (v_follower, v_cid);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.follower_broadcasts (sender_user_id, community_id, body)
  values (v_organizer, v_cid, 'community push fanout selftest')
  returning id into v_row_id;
  select public.fanout_follower_broadcast_push(v_row_id) into v_sent;
  reset role;
  if v_sent <> 1 then
    raise exception 'SELF-TEST FAIL: expected 1 community push fanned out, got %', v_sent;
  end if;

  select count(*) into v_notif_count from public.app_notifications
  where user_id = v_follower and type = 'community_broadcast' and body = 'community push fanout selftest';
  if v_notif_count <> 1 then
    raise exception 'SELF-TEST FAIL: community follower did not receive exactly 1 app_notifications row';
  end if;

  -- cleanup
  delete from public.app_notifications where actor_user_id = v_organizer and body in ('push fanout selftest', 'community push fanout selftest');
  delete from public.follower_broadcasts where organizer_user_id = v_organizer or community_id = v_cid;
  delete from public.organizer_follows where follower_user_id = v_follower and (organizer_user_id = v_organizer or community_id = v_cid);
  delete from public.community_members where community_id = v_cid;
  delete from public.communities where id = v_cid;
  if v_inserted_organizer_profile then
    delete from public.organizer_profiles where user_id = v_organizer;
  end if;

  raise notice 'follower_broadcast_push_fanout self-test passed';
end;
$$;

commit;
