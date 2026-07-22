-- ============================================================================
-- THE ONE BATCH (proposal doc 15 v3): all remaining MVP schema.
-- Cowork-approved (calls a-j round 1; send-path gap fix round 2 = calls k-m;
-- Liz's event-chat reversal = call d REVERSED, all topic machinery cut).
-- APPLIED to prod 2026-07-06 after ROLLBACK dry-runs v1-v3 (v1 caught a
-- frozen-now() fixture artifact, v2 added send paths, v3 = the reversal);
-- all in-transaction self-tests passed on apply; post-apply verified: rsvp
-- table, 8 fns, broadcast trigger, CHECK 31, mute + notified_at columns,
-- plans index, reactions realtime, zero leftovers, 7 pilot events untouched.
-- Full deliberate-call record in Events_Communities/15 (the proposal doc).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. explore_events: owner read + the operator create/update RPCs
--    (the non-admin counterparts of admin_create/update_explore_event)
-- ---------------------------------------------------------------------------

-- operators see their own events in every status (closes the logged phase 5
-- gap: RLS only exposed Live rows to non-admins)
create policy "Operators can view own explore events"
  on public.explore_events for select
  using (
    host_user_id = (select auth.uid())
    or (community_id is not null and is_community_leader(community_id, (select auth.uid())))
  );

create or replace function public.operator_create_explore_event(
  p_title text,
  p_description text default null,
  p_image_url text default null,
  p_event_date text default null,
  p_start_time timestamptz default null,
  p_venue text default null,
  p_venue_address text default null,
  p_category text default null,
  p_external_url text default null,
  p_ticket_price text default null,
  p_community_id uuid default null,
  p_public_name text default null
)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if not (has_operator_grant(v_uid, 'event_host'::operator_track)
          or has_operator_grant(v_uid, 'community_leader'::operator_track)) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' or char_length(p_title) > 120 then
    raise exception 'A title is required.';
  end if;
  -- attribution: only a leader of that community can post as it
  if p_community_id is not null
     and not is_community_leader(p_community_id, v_uid) then
    raise exception 'Not authorized for that community';
  end if;

  insert into explore_events (
    title, description, image_url, event_date, start_time, venue,
    venue_address, category, external_url, ticket_price,
    host_user_id, community_id, public_name, status
  ) values (
    btrim(p_title),
    nullif(btrim(p_description), ''),
    nullif(btrim(p_image_url), ''),
    nullif(btrim(p_event_date), '')::date,
    p_start_time,
    nullif(btrim(p_venue), ''),
    nullif(btrim(p_venue_address), ''),
    nullif(btrim(p_category), ''),
    nullif(btrim(p_external_url), ''),
    nullif(btrim(p_ticket_price), '')::numeric,
    v_uid,
    p_community_id,
    nullif(btrim(p_public_name), ''),
    'Live'  -- deliberate call a: vetted at grant time
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text) from public;
revoke all on function public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text) from anon;
grant execute on function public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text) to authenticated;

create or replace function public.operator_update_explore_event(
  p_event_id uuid,
  p_title text,
  p_description text default null,
  p_image_url text default null,
  p_event_date text default null,
  p_start_time timestamptz default null,
  p_venue text default null,
  p_venue_address text default null,
  p_category text default null,
  p_external_url text default null,
  p_ticket_price text default null,
  p_public_name text default null,
  p_status text default null
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, host_user_id, community_id into v_row
  from explore_events where id = p_event_id;
  if v_row.id is null then
    raise exception 'Event not found';
  end if;
  if not (v_row.host_user_id = v_uid
          or (v_row.community_id is not null and is_community_leader(v_row.community_id, v_uid))) then
    raise exception 'Not authorized';
  end if;
  if coalesce(btrim(p_title), '') = '' or char_length(p_title) > 120 then
    raise exception 'A title is required.';
  end if;
  if p_status is not null and p_status not in ('Live', 'Completed', 'Cancelled') then
    raise exception 'Invalid status';
  end if;

  update explore_events set
    title = btrim(p_title),
    description = nullif(btrim(p_description), ''),
    image_url = nullif(btrim(p_image_url), ''),
    event_date = nullif(btrim(p_event_date), '')::date,
    start_time = p_start_time,
    venue = nullif(btrim(p_venue), ''),
    venue_address = nullif(btrim(p_venue_address), ''),
    category = nullif(btrim(p_category), ''),
    external_url = nullif(btrim(p_external_url), ''),
    ticket_price = nullif(btrim(p_ticket_price), '')::numeric,
    public_name = nullif(btrim(p_public_name), ''),
    status = coalesce(p_status, status),
    updated_at = now()
  where id = p_event_id;
end;
$$;

comment on function public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, text) is
  'FULL-OVERWRITE, matching the admin twin: every omitted optional param NULLS its column. Clients must ALWAYS send the complete field set, never a partial patch.';

revoke all on function public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, text) from public;
revoke all on function public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, text) from anon;
grant execute on function public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. just-join: explore_event_rsvps
-- ---------------------------------------------------------------------------
create table public.explore_event_rsvps (
  id uuid primary key default gen_random_uuid(),
  explore_event_id uuid not null references public.explore_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'going' check (status in ('going', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (explore_event_id, user_id)
);

create index explore_event_rsvps_event_idx
  on public.explore_event_rsvps (explore_event_id) where status = 'going';

alter table public.explore_event_rsvps enable row level security;

-- deliberate call c: you see your own; the event's owner sees the list
create policy explore_event_rsvps_select
  on public.explore_event_rsvps for select
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from explore_events e
      where e.id = explore_event_id
        and (e.host_user_id = (select auth.uid())
             or (e.community_id is not null and is_community_leader(e.community_id, (select auth.uid()))))
    )
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );
create policy explore_event_rsvps_insert
  on public.explore_event_rsvps for insert
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from explore_events e where e.id = explore_event_id and e.status = 'Live')
  );
create policy explore_event_rsvps_update
  on public.explore_event_rsvps for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy explore_event_rsvps_delete
  on public.explore_event_rsvps for delete
  using (user_id = (select auth.uid()) or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role));

grant select, insert, update, delete on public.explore_event_rsvps to authenticated;

-- public count, same privacy shape as the community member count
create or replace function public.get_event_rsvp_count(p_event_id uuid)
returns integer
language sql stable security definer
set search_path to 'public'
as $$
  select case
    when exists (select 1 from explore_events e where e.id = p_event_id and e.status = 'Live')
    then (select count(*)::integer from explore_event_rsvps r
          where r.explore_event_id = p_event_id and r.status = 'going')
    else null
  end;
$$;

revoke all on function public.get_event_rsvp_count(uuid) from public;
grant execute on function public.get_event_rsvp_count(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. the Chats communities section: one card per community, one round trip
--    (deliberate call f). Scoped HARD to the caller; returns jsonb.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_community_chat_cards()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(card order by (card->>'last_activity_at') desc nulls last), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'community_id', c.id,
      'handle', c.handle,
      'name', c.name,
      'accent_color', c.accent_color,
      'role', m.role,
      'latest_broadcast', lb.broadcast,
      'unread_broadcasts', coalesce(ub.n, 0),
      'topics', coalesce(tp.topics, '[]'::jsonb),
      'unread_total', coalesce(ub.n, 0) + coalesce(tp.unread_topics_total, 0),
      'last_activity_at', greatest(lb.latest_at, tp.latest_message_at)
    ) as card
    from community_members m
    join communities c on c.id = m.community_id and c.status = 'active'
    left join lateral (
      select jsonb_build_object(
               'id', b.id, 'body', b.body, 'created_at', b.created_at,
               'sender_id', b.sender_id
             ) as broadcast,
             b.created_at as latest_at
      from community_broadcasts b
      where b.community_id = c.id
      order by b.created_at desc
      limit 1
    ) lb on true
    left join lateral (
      select count(*)::integer as n
      from community_broadcasts b
      where b.community_id = c.id
        and b.sender_id is distinct from auth.uid()
        and b.created_at > coalesce(
          (select r.last_read_at from community_broadcast_reads r
           where r.community_id = c.id and r.user_id = auth.uid()),
          m.joined_at, m.created_at)
    ) ub on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'is_default', t.is_default,
               'joined', (tm.user_id is not null),
               'notifications_on', coalesce(tm.notifications_on, false),
               'unread', coalesce(tu.n, 0),
               'last_message_at', lm.latest_at
             ) order by t.is_default desc, lm.latest_at desc nulls last) as topics,
             sum(coalesce(tu.n, 0))::integer as unread_topics_total,
             max(lm.latest_at) filter (where tm.user_id is not null) as latest_message_at
      from community_topics t
      left join community_topic_members tm
        on tm.topic_id = t.id and tm.user_id = auth.uid()
      left join lateral (
        select max(msg.created_at) as latest_at
        from community_topic_messages msg where msg.topic_id = t.id
      ) lm on true
      left join lateral (
        select count(*)::integer as n
        from community_topic_messages msg
        where msg.topic_id = t.id
          and tm.user_id is not null
          and msg.sender_id is distinct from auth.uid()
          and msg.created_at > coalesce(
            (select r.last_read_at from community_topic_reads r
             where r.topic_id = t.id and r.user_id = auth.uid()),
            tm.joined_at)
      ) tu on true
      where t.community_id = c.id and not t.archived
    ) tp on true
    where m.user_id = auth.uid() and m.status = 'active'
  ) cards;
$$;

revoke all on function public.get_my_community_chat_cards() from public;
revoke all on function public.get_my_community_chat_cards() from anon;
grant execute on function public.get_my_community_chat_cards() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Scene discovery: the communities rail in one call. Public data only
--    (active communities, count, first cover image, soonest Live event).
-- ---------------------------------------------------------------------------
create or replace function public.get_discoverable_communities()
returns table (
  id uuid,
  handle text,
  name text,
  description text,
  accent_color text,
  cover_image text,
  member_count integer,
  next_event_title text,
  next_event_date date
)
language sql stable security definer
set search_path to 'public'
as $$
  select
    c.id, c.handle, c.name, c.description, c.accent_color,
    (select b.content->'images'->>0
     from community_blocks b
     where b.community_id = c.id and b.block_type = 'cover' and b.visible
     order by b.position limit 1) as cover_image,
    (select count(*)::integer from community_members m
     where m.community_id = c.id and m.status = 'active') as member_count,
    ne.title as next_event_title,
    ne.event_date as next_event_date
  from communities c
  left join lateral (
    select e.title, e.event_date
    from explore_events e
    where e.community_id = c.id and e.status = 'Live'
      and coalesce(e.event_date, current_date) >= current_date
    order by e.event_date asc nulls last
    limit 1
  ) ne on true
  where c.status = 'active'
  order by member_count desc, c.created_at asc
  limit 100;
$$;

revoke all on function public.get_discoverable_communities() from public;
grant execute on function public.get_discoverable_communities() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. notification-type seams (deliberate call h): 29 -> 31
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint where conname = 'app_notifications_type_check';
  if v_def is null then
    raise exception 'SELF-TEST FAIL: app_notifications_type_check not found';
  end if;
  if (length(v_def) - length(replace(v_def, '::text', ''))) / length('::text') <> 29 then
    raise exception 'SELF-TEST FAIL: live type CHECK is not the expected 29 values; re-read prod before applying';
  end if;
end;
$$;

alter table public.app_notifications
  drop constraint app_notifications_type_check;
alter table public.app_notifications
  add constraint app_notifications_type_check check (type = any (array[
    'waitlist_spot', 'broadcast', 'event_reminder', 'member_joined',
    'plan_invite', 'invite_accepted', 'new_message', 'album_ready',
    'plan_cancelled', 'duplicate_plan', 'interest_signal', 'interest_invite',
    'album_upload_prompt', 'album_upload_reminder', 'album_someone_uploaded',
    'album_more_photos_added', 'album_creator_no_uploads_nudge',
    'album_hearts_batched', 'waitlist_request', 'exception_invite',
    'exception_slot_refunded', 'people_request', 'people_request_accepted',
    'people_ping', 'referral_joined', 'operator_grant',
    'community_join_request', 'community_join_approved', 'community_join_declined',
    'community_broadcast', 'community_event'
  ]));

-- ---------------------------------------------------------------------------
-- 6b. notification SEND PATHS (Cowork review round 1 gap fix; calls k, l, m)
-- ---------------------------------------------------------------------------
-- doc 09 mute-not-leave (call k)
alter table public.community_members
  add column broadcasts_muted boolean not null default false;

comment on column public.community_members.broadcasts_muted is
  'Doc 09 mute-not-leave: silences broadcast and event-announce notifications for this member. Written ONLY via set_community_broadcast_mute (member self-updates are otherwise leader-only by design). Unread badges still count via the reads tables.';

-- one-shot announce guard (call l)
alter table public.explore_events
  add column members_notified_at timestamptz;

create or replace function public.set_community_broadcast_mute(
  p_community_id uuid,
  p_muted boolean
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  update community_members
  set broadcasts_muted = p_muted
  where community_id = p_community_id and user_id = v_uid and status = 'active';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Not a member of that community.';
  end if;
end;
$$;

revoke all on function public.set_community_broadcast_mute(uuid, boolean) from public;
revoke all on function public.set_community_broadcast_mute(uuid, boolean) from anon;
grant execute on function public.set_community_broadcast_mute(uuid, boolean) to authenticated;

-- broadcast fan-out: every active, unmuted member except the sender.
-- LIZ COPY taste call 8: title is the community name, body is the broadcast.
create or replace function public.notify_community_broadcast()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
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
$$;

create trigger trg_notify_community_broadcast
  after insert on public.community_broadcasts
  for each row execute function public.notify_community_broadcast();

-- "tell your members" at publish: leader-only, Live-only, one-shot, never
-- automatic. LIZ COPY taste call 9.
create or replace function public.notify_community_event(p_event_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_event record;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, title, community_id, status, members_notified_at into v_event
  from explore_events where id = p_event_id;
  if v_event.id is null or v_event.community_id is null then
    raise exception 'Not a community event';
  end if;
  if not is_community_leader(v_event.community_id, v_uid) then
    raise exception 'Not authorized';
  end if;
  if v_event.status <> 'Live' then
    raise exception 'Only a live event can be announced.';
  end if;
  if v_event.members_notified_at is not null then
    raise exception 'Your members already heard about this one.';
  end if;

  update explore_events set members_notified_at = now() where id = p_event_id;

  select name into v_name from communities where id = v_event.community_id;
  insert into app_notifications (user_id, type, title, body, actor_user_id)
  select m.user_id,
         'community_event',
         v_name,
         'just posted ' || v_event.title || '.',
         v_uid
  from community_members m
  where m.community_id = v_event.community_id
    and m.status = 'active'
    and not m.broadcasts_muted
    and m.user_id is distinct from v_uid;
end;
$$;

revoke all on function public.notify_community_event(uuid) from public;
revoke all on function public.notify_community_event(uuid) from anon;
grant execute on function public.notify_community_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. small riders: realtime for reactions (call g), the missing plans index
--    (call i)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.community_broadcast_reactions;

create index events_explore_event_idx
  on public.events (explore_event_id) where explore_event_id is not null;

-- ---------------------------------------------------------------------------
-- 8. in-transaction self-tests (never strip on apply)
-- ---------------------------------------------------------------------------
do $$
declare
  v_leader uuid;
  v_member uuid;
  v_outsider uuid;
  v_cid uuid;
  v_eid uuid;
  v_grant_id uuid;
  v_raised boolean;
  v_count integer;
  v_cards jsonb;
begin
  -- three non-admin users
  select id into v_leader from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_member from auth.users u
  where u.id <> v_leader
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_outsider from auth.users u
  where u.id not in (v_leader, v_member)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_leader is null or v_member is null or v_outsider is null then
    raise exception 'SELF-TEST FAIL: needs three existing non-admin users';
  end if;

  insert into public.communities (handle, name, created_by, status)
  values ('selftest-mvp-batch', 'MVP Batch Selftest', v_leader, 'active')
  returning id into v_cid;
  -- joined_at sits in the past: now() is frozen per transaction, and the
  -- unread comparison is strictly greater (a broadcast at the exact join
  -- instant is not unread), so same-instant fixtures would always read 0
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_leader, 'leader', 'active', now() - interval '1 hour');
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_member, 'member', 'active', now() - interval '1 hour');
  insert into public.operator_grants (user_id, track, status, application)
  values (v_leader, 'community_leader', 'approved', '{}'::jsonb)
  returning id into v_grant_id;

  -- 8a. no grant -> create refused
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform public.operator_create_explore_event(p_title => 'nope');
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: ungranted user created an event';
  end if;

  -- 8b. leader creates a community-attributed event: Live, owned
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  v_eid := public.operator_create_explore_event(
    p_title => 'Selftest Sunset Watch',
    p_description => 'a test event',
    p_event_date => to_char(current_date + 7, 'YYYY-MM-DD'),
    p_category => 'community',
    p_community_id => v_cid,
    p_public_name => 'Sunset Selftest Club'
  );
  if not exists (select 1 from public.explore_events
                 where id = v_eid and status = 'Live' and host_user_id = v_leader
                   and community_id = v_cid and public_name = 'Sunset Selftest Club') then
    raise exception 'SELF-TEST FAIL: operator event row wrong';
  end if;

  -- 8b2. "tell your members": member notified, sender never, outsider never,
  --      strictly one-shot (claims are still the leader's here)
  perform public.notify_community_event(v_eid);
  if not exists (select 1 from public.app_notifications
                 where user_id = v_member and type = 'community_event' and actor_user_id = v_leader) then
    raise exception 'SELF-TEST FAIL: member missed the event announce';
  end if;
  if exists (select 1 from public.app_notifications
             where user_id = v_leader and type = 'community_event') then
    raise exception 'SELF-TEST FAIL: the announcing leader notified themselves';
  end if;
  if exists (select 1 from public.app_notifications
             where user_id = v_outsider and type = 'community_event') then
    raise exception 'SELF-TEST FAIL: a non-member got the event announce';
  end if;
  v_raised := false;
  begin
    perform public.notify_community_event(v_eid);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: the event announce is not one-shot';
  end if;
  -- and a non-leader cannot announce at all
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform public.notify_community_event(v_eid);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-leader announced an event';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);

  -- 8d. member RSVPs under the real authenticated role; count = 1; dupe blocked
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.explore_event_rsvps (explore_event_id, user_id)
  values (v_eid, v_member);
  v_raised := false;
  begin
    insert into public.explore_event_rsvps (explore_event_id, user_id)
    values (v_eid, v_member);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    reset role;
    raise exception 'SELF-TEST FAIL: duplicate RSVP allowed';
  end if;
  reset role;
  if public.get_event_rsvp_count(v_eid) <> 1 then
    raise exception 'SELF-TEST FAIL: rsvp count wrong';
  end if;

  -- 8e. RSVP privacy: an outsider sees no rows, the host sees the list
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.explore_event_rsvps where explore_event_id = v_eid;
  if v_count <> 0 then
    reset role;
    raise exception 'SELF-TEST FAIL: rsvp identities leak to non-owners';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.explore_event_rsvps where explore_event_id = v_eid;
  if v_count <> 1 then
    reset role;
    raise exception 'SELF-TEST FAIL: the event owner cannot see the rsvp list';
  end if;
  reset role;

  -- 8f. a non-owner cannot update the event; the owner can complete it;
  --     owner-read keeps the non-Live row visible
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform public.operator_update_explore_event(p_event_id => v_eid, p_title => 'hijack');
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-owner updated the event';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  perform public.operator_update_explore_event(
    p_event_id => v_eid,
    p_title => 'Selftest Sunset Watch',
    p_event_date => to_char(current_date + 7, 'YYYY-MM-DD'),
    p_category => 'community',
    p_public_name => 'Sunset Selftest Club',
    p_status => 'Completed'
  );
  if not exists (select 1 from public.explore_events where id = v_eid and status = 'Completed') then
    raise exception 'SELF-TEST FAIL: owner could not complete their event';
  end if;
  set local role authenticated;
  if not exists (select 1 from public.explore_events where id = v_eid) then
    reset role;
    raise exception 'SELF-TEST FAIL: owner-read policy missing (owner lost their non-Live event)';
  end if;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if exists (select 1 from public.explore_events where id = v_eid) then
    reset role;
    raise exception 'SELF-TEST FAIL: a non-owner can see a non-Live event';
  end if;
  reset role;

  -- 8g. chat cards: seed a broadcast, the member's card carries the unread
  insert into public.community_broadcasts (community_id, sender_id, body)
  values (v_cid, v_leader, 'selftest broadcast');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  v_cards := public.get_my_community_chat_cards();
  if jsonb_array_length(v_cards) < 1 then
    raise exception 'SELF-TEST FAIL: member has no chat card';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_cards) card
    where card->>'community_id' = v_cid::text
      and (card->>'unread_broadcasts')::integer = 1
      and card->'latest_broadcast'->>'body' = 'selftest broadcast'
  ) then
    raise exception 'SELF-TEST FAIL: chat card unread or preview wrong';
  end if;
  -- the leader reading their own card counts no self-unread
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  v_cards := public.get_my_community_chat_cards();
  if not exists (
    select 1 from jsonb_array_elements(v_cards) card
    where card->>'community_id' = v_cid::text
      and (card->>'unread_broadcasts')::integer = 0
  ) then
    raise exception 'SELF-TEST FAIL: own broadcast counted as unread';
  end if;
  -- an outsider gets no card for this community
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  v_cards := public.get_my_community_chat_cards();
  if exists (
    select 1 from jsonb_array_elements(v_cards) card
    where card->>'community_id' = v_cid::text
  ) then
    raise exception 'SELF-TEST FAIL: chat cards leak across memberships';
  end if;

  -- 8g2. broadcast fan-out: the 8g broadcast notified the member once,
  --       never the sender, never the outsider; mute silences, unmute restores
  select count(*) into v_count from public.app_notifications
  where user_id = v_member and type = 'community_broadcast' and actor_user_id = v_leader;
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: broadcast fan-out wrong (member has % rows)', v_count;
  end if;
  if exists (select 1 from public.app_notifications
             where user_id = v_leader and type = 'community_broadcast') then
    raise exception 'SELF-TEST FAIL: broadcast notified its own sender';
  end if;
  if exists (select 1 from public.app_notifications
             where user_id = v_outsider and type = 'community_broadcast') then
    raise exception 'SELF-TEST FAIL: broadcast notified a non-member';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform public.set_community_broadcast_mute(v_cid, true);
  insert into public.community_broadcasts (community_id, sender_id, body)
  values (v_cid, v_leader, 'muted broadcast');
  select count(*) into v_count from public.app_notifications
  where user_id = v_member and type = 'community_broadcast';
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: mute did not silence the broadcast';
  end if;
  perform public.set_community_broadcast_mute(v_cid, false);
  insert into public.community_broadcasts (community_id, sender_id, body)
  values (v_cid, v_leader, 'unmuted broadcast');
  select count(*) into v_count from public.app_notifications
  where user_id = v_member and type = 'community_broadcast';
  if v_count <> 2 then
    raise exception 'SELF-TEST FAIL: unmute did not restore broadcasts';
  end if;
  -- an outsider cannot touch the mute flag
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  v_raised := false;
  begin
    perform public.set_community_broadcast_mute(v_cid, true);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-member set a mute flag';
  end if;

  -- 8h. discovery rail: the test community appears with count 2
  if not exists (
    select 1 from public.get_discoverable_communities() d
    where d.id = v_cid and d.member_count = 2
  ) then
    raise exception 'SELF-TEST FAIL: discoverable communities wrong';
  end if;

  -- 8i. the plans index exists
  if not exists (select 1 from pg_indexes where schemaname = 'public'
                 and tablename = 'events' and indexname = 'events_explore_event_idx') then
    raise exception 'SELF-TEST FAIL: events explore_event index missing';
  end if;

  -- 8j. anon blocked on the operator RPCs and the cards RPC
  if has_function_privilege('anon', 'public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute operator_create_explore_event';
  end if;
  if has_function_privilege('anon', 'public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, text)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute operator_update_explore_event';
  end if;
  if has_function_privilege('anon', 'public.get_my_community_chat_cards()', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute get_my_community_chat_cards';
  end if;
  if has_function_privilege('anon', 'public.notify_community_event(uuid)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute notify_community_event';
  end if;
  if has_function_privilege('anon', 'public.set_community_broadcast_mute(uuid, boolean)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can execute set_community_broadcast_mute';
  end if;

  -- cleanup: the event row and grant are ours; the community cascades the rest
  delete from public.app_notifications
  where type in ('community_broadcast', 'community_event')
    and user_id in (v_leader, v_member, v_outsider);
  delete from public.explore_event_rsvps where explore_event_id = v_eid;
  delete from public.explore_events where id = v_eid;
  delete from public.operator_grants where id = v_grant_id;
  delete from public.communities where id = v_cid;

  raise notice 'mvp batch self-test passed';
end;
$$;

commit;
