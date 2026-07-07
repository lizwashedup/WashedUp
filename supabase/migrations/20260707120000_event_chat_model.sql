-- ============================================================================
-- Event chat model (proposal doc 18, Cowork-approved incl the ghost-attendee
-- DELETE fix; Liz confirmed the model 2026-07-07). APPLIED to prod
-- 2026-07-07 after four ROLLBACK dry-runs: run 1 caught the category 23502
-- (both operator RPCs now fail friendly), run 2 caught 42P17 policy
-- recursion (is_topic_member definer breaker, the phase-1 pattern), run 3
-- passed, run 4 passed with the RSVP-DELETE ghost-attendee fix. Self-tests
-- passed on apply; post-apply verified (columns, helper+trigger fns, cron,
-- single RPC overloads, zero test leftovers).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. the event-chat link + the pin seam
-- ---------------------------------------------------------------------------
alter table public.community_topics
  add column explore_event_id uuid references public.explore_events(id) on delete set null;

create unique index community_topics_one_per_event
  on public.community_topics (explore_event_id) where explore_event_id is not null;

comment on column public.community_topics.explore_event_id is
  'Set = this topic is the chat for that community event: born at publish, admits by attendance (RSVP), archived 48h after start.';

alter table public.explore_events
  add column pin_to_chat boolean not null default true;

comment on column public.explore_events.pin_to_chat is
  'Creator toggle: whether this event may sit pinned at the top of the main community chat. The client shows only the soonest upcoming pinned one.';

-- ---------------------------------------------------------------------------
-- 2. attendee access: three of our own policies gain ONE branch each,
--    scoped strictly to event topics (explore_event_id is not null).
--    Ordinary community topics keep member-only rules verbatim.
--    is_topic_member is the recursion breaker: the topics policy must read
--    topic memberships, whose own policy reads topics back; a security
--    definer helper (the phase-1 is_community_member pattern, probe-guarded
--    to the caller) cuts the cycle. The dry-run caught the 42P17 without it.
-- ---------------------------------------------------------------------------
create or replace function public.is_topic_member(p_topic_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
      select 1 from community_topic_members tm
      where tm.topic_id = p_topic_id and tm.user_id = p_user_id
    );
$$;

revoke all on function public.is_topic_member(uuid, uuid) from public;
grant execute on function public.is_topic_member(uuid, uuid) to anon, authenticated;

drop policy community_topics_select on public.community_topics;
create policy community_topics_select on public.community_topics
  for select using (
    is_community_member(community_id, (select auth.uid()))
    -- NEW: an attendee sees the event topic they belong to
    or (explore_event_id is not null
        and is_topic_member(id, (select auth.uid())))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

drop policy community_topic_messages_select on public.community_topic_messages;
create policy community_topic_messages_select on public.community_topic_messages
  for select using (
    (exists (
      select 1 from community_topics t
      where t.id = community_topic_messages.topic_id
        and is_community_member(t.community_id, (select auth.uid()))
    ))
    -- NEW: attendees read the event topic they belong to
    or (exists (
      select 1 from community_topics t
      where t.id = community_topic_messages.topic_id
        and t.explore_event_id is not null
        and is_topic_member(t.id, (select auth.uid()))
    ))
    or is_admin((select auth.uid())) or has_role((select auth.uid()), 'admin'::app_role)
  );

drop policy community_topic_messages_insert on public.community_topic_messages;
create policy community_topic_messages_insert on public.community_topic_messages
  for insert with check (
    sender_id = (select auth.uid())
    and is_topic_member(topic_id, (select auth.uid()))
    and exists (
      select 1 from community_topics t
      where t.id = community_topic_messages.topic_id
        and not t.archived
        -- NEW: membership in an event topic suffices (the first EXISTS
        -- already required it); ordinary topics still demand community
        -- membership
        and (is_community_member(t.community_id, (select auth.uid()))
             or t.explore_event_id is not null)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. attendance: RSVP going puts you in, cancelling takes you out (call b)
-- ---------------------------------------------------------------------------
create or replace function public.sync_event_chat_membership()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_topic_id uuid;
begin
  -- Cowork review fix: DELETE is a real path (the RLS delete policy lets a
  -- user remove their own RSVP row directly); without this branch they sat
  -- in the event chat as a ghost attendee.
  if tg_op = 'DELETE' then
    select t.id into v_topic_id
    from community_topics t
    where t.explore_event_id = old.explore_event_id;
    if v_topic_id is not null then
      delete from community_topic_members
      where topic_id = v_topic_id and user_id = old.user_id;
    end if;
    return old;
  end if;

  select t.id into v_topic_id
  from community_topics t
  where t.explore_event_id = new.explore_event_id;
  if v_topic_id is null then
    return new; -- standalone event, or topic not born yet
  end if;
  if new.status = 'going' then
    insert into community_topic_members (topic_id, user_id)
    values (v_topic_id, new.user_id)
    on conflict (topic_id, user_id) do nothing;
  elsif new.status = 'cancelled' then
    delete from community_topic_members
    where topic_id = v_topic_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger trg_event_rsvp_chat_membership
  after insert or update of status or delete on public.explore_event_rsvps
  for each row execute function public.sync_event_chat_membership();

-- ---------------------------------------------------------------------------
-- 4. operator RPCs: the event chat is born at publish; the pin rides along
--    (both are our batch-15 functions, replaced; FULL-OVERWRITE contract
--    unchanged and p_pin_to_chat joins the complete field set)
-- ---------------------------------------------------------------------------
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
  p_public_name text default null,
  p_pin_to_chat boolean default true
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
  -- category is NOT NULL on explore_events; fail friendly, not with a 23502
  -- (the dry-run caught the ugly path)
  if coalesce(btrim(p_category), '') = '' then
    raise exception 'Pick a category.';
  end if;
  if p_community_id is not null
     and not is_community_leader(p_community_id, v_uid) then
    raise exception 'Not authorized for that community';
  end if;

  insert into explore_events (
    title, description, image_url, event_date, start_time, venue,
    venue_address, category, external_url, ticket_price,
    host_user_id, community_id, public_name, pin_to_chat, status
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
    coalesce(p_pin_to_chat, true),
    'Live'
  ) returning id into v_id;

  -- the event chat exists from the moment the event posts (community only;
  -- standalone events never chat, confirmed hard)
  if p_community_id is not null then
    insert into community_topics (community_id, name, created_by, explore_event_id)
    values (p_community_id, left(btrim(p_title), 60), v_uid, v_id);
  end if;

  return v_id;
end;
$$;

revoke all on function public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean) from public;
revoke all on function public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean) from anon;
grant execute on function public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean) to authenticated;
-- the batch-15 12-arg signature is superseded; drop it so PostgREST cannot
-- route to the stale overload
drop function if exists public.operator_create_explore_event(text, text, text, text, timestamptz, text, text, text, text, text, uuid, text);

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
  p_pin_to_chat boolean default true,
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
  -- category is NOT NULL; the full-overwrite must not null it into a 23502
  if coalesce(btrim(p_category), '') = '' then
    raise exception 'Pick a category.';
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
    pin_to_chat = coalesce(p_pin_to_chat, true),
    status = coalesce(p_status, status),
    updated_at = now()
  where id = p_event_id;

  -- the event chat follows its event: name syncs, cancel/complete archives
  update community_topics
  set name = left(btrim(p_title), 60),
      archived = archived or coalesce(p_status, '') in ('Cancelled', 'Completed')
  where explore_event_id = p_event_id;
end;
$$;

comment on function public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, boolean, text) is
  'FULL-OVERWRITE, matching the admin twin: every omitted optional param NULLS (or defaults) its column. Clients must ALWAYS send the complete field set, never a partial patch.';

revoke all on function public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, boolean, text) from public;
revoke all on function public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, boolean, text) from anon;
grant execute on function public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, boolean, text) to authenticated;
drop function if exists public.operator_update_explore_event(uuid, text, text, text, text, timestamptz, text, text, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 5. the archive cron returns (call d): event chats gather, then close
-- ---------------------------------------------------------------------------
select cron.schedule(
  'archive-community-event-topics',
  '17 10 * * *',  -- daily, early morning LA
  $cron$
  update public.community_topics t
  set archived = true
  where t.explore_event_id is not null
    and not t.archived
    and exists (
      select 1 from public.explore_events e
      where e.id = t.explore_event_id
        and coalesce(e.start_time, e.event_date::timestamptz) < now() - interval '48 hours'
    );
  $cron$
);

-- ---------------------------------------------------------------------------
-- 6. the cards RPC learns about attendees (call e): shape becomes
--    {"cards": [...], "attendee_topics": [...]} so a non-member attendee
--    sees their event chat in the unified list
-- ---------------------------------------------------------------------------
create or replace function public.get_my_community_chat_cards()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'cards',
    coalesce((
      select jsonb_agg(card order by (card->>'last_activity_at') desc nulls last)
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
                   'explore_event_id', t.explore_event_id,
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
      ) cards
    ), '[]'::jsonb),
    'attendee_topics',
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', t.name,
               'community_id', c.id,
               'community_name', c.name,
               'accent_color', c.accent_color,
               'explore_event_id', t.explore_event_id,
               'notifications_on', tm.notifications_on,
               'unread', coalesce((
                 select count(*)::integer
                 from community_topic_messages msg
                 where msg.topic_id = t.id
                   and msg.sender_id is distinct from auth.uid()
                   and msg.created_at > coalesce(
                     (select r.last_read_at from community_topic_reads r
                      where r.topic_id = t.id and r.user_id = auth.uid()),
                     tm.joined_at)
               ), 0),
               'last_message_at', (
                 select max(msg.created_at)
                 from community_topic_messages msg where msg.topic_id = t.id
               ),
               'joined_at', tm.joined_at
             ) order by tm.joined_at desc)
      from community_topic_members tm
      join community_topics t on t.id = tm.topic_id
      join communities c on c.id = t.community_id
      where tm.user_id = auth.uid()
        and t.explore_event_id is not null
        and not t.archived
        -- attendee = in the event chat WITHOUT community membership; members
        -- already get these topics inside their card
        and not exists (
          select 1 from community_members m
          where m.community_id = t.community_id
            and m.user_id = auth.uid() and m.status = 'active'
        )
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_my_community_chat_cards() from public;
revoke all on function public.get_my_community_chat_cards() from anon;
grant execute on function public.get_my_community_chat_cards() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. backfill (call f): existing Live community events get their chats,
--    current going RSVPs get their memberships. Idempotent.
-- ---------------------------------------------------------------------------
insert into public.community_topics (community_id, name, created_by, explore_event_id)
select e.community_id, left(e.title, 60), e.host_user_id, e.id
from public.explore_events e
where e.community_id is not null
  and e.status = 'Live'
  and not exists (select 1 from public.community_topics t where t.explore_event_id = e.id);

insert into public.community_topic_members (topic_id, user_id)
select t.id, r.user_id
from public.explore_event_rsvps r
join public.community_topics t on t.explore_event_id = r.explore_event_id
where r.status = 'going'
on conflict (topic_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 8. in-transaction self-tests (never strip on apply)
-- ---------------------------------------------------------------------------
do $$
declare
  v_creator uuid;
  v_member uuid;
  v_attendee uuid;
  v_cid uuid;
  v_eid uuid;
  v_standalone_eid uuid;
  v_topic_id uuid;
  v_grant_id uuid;
  v_raised boolean;
  v_count integer;
  v_payload jsonb;
begin
  select id into v_creator from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_member from auth.users u
  where u.id <> v_creator
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_attendee from auth.users u
  where u.id not in (v_creator, v_member)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_creator is null or v_member is null or v_attendee is null then
    raise exception 'SELF-TEST FAIL: needs three existing non-admin users';
  end if;

  insert into public.communities (handle, name, created_by, status)
  values ('selftest-event-chat', 'Event Chat Selftest', v_creator, 'active')
  returning id into v_cid;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_creator, 'leader', 'active', now() - interval '1 hour');
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_member, 'member', 'active', now() - interval '1 hour');
  insert into public.operator_grants (user_id, track, status, application)
  values (v_creator, 'community_leader', 'approved', '{}'::jsonb)
  returning id into v_grant_id;

  -- 8a. a community event's chat exists from the moment it posts
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  v_eid := public.operator_create_explore_event(
    p_title => 'Selftest Sunset Watch',
    p_event_date => to_char(current_date + 7, 'YYYY-MM-DD'),
    p_category => 'community',
    p_community_id => v_cid,
    p_pin_to_chat => true
  );
  select id into v_topic_id from public.community_topics
  where explore_event_id = v_eid;
  if v_topic_id is null then
    raise exception 'SELF-TEST FAIL: event chat not born at publish';
  end if;
  if not exists (select 1 from public.explore_events where id = v_eid and pin_to_chat) then
    raise exception 'SELF-TEST FAIL: pin_to_chat did not persist';
  end if;

  -- 8b. standalone events never chat, confirmed hard
  -- and an empty category fails friendly, never with a bare 23502
  v_raised := false;
  begin
    perform public.operator_create_explore_event(p_title => 'no category');
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: empty category was accepted';
  end if;
  v_standalone_eid := public.operator_create_explore_event(
    p_title => 'Selftest Standalone',
    p_event_date => to_char(current_date + 7, 'YYYY-MM-DD'),
    p_category => 'community'
  );
  if exists (select 1 from public.community_topics where explore_event_id = v_standalone_eid) then
    raise exception 'SELF-TEST FAIL: a standalone event grew a chat';
  end if;

  -- 8c. RSVP puts a NON-MEMBER attendee in; they can read and speak there
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.explore_event_rsvps (explore_event_id, user_id)
  values (v_eid, v_attendee);
  if not exists (select 1 from public.community_topics where id = v_topic_id) then
    reset role;
    raise exception 'SELF-TEST FAIL: attendee cannot see the event topic';
  end if;
  insert into public.community_topic_messages (topic_id, sender_id, body)
  values (v_topic_id, v_attendee, 'attendee says hi');
  select count(*) into v_count from public.community_topic_messages where topic_id = v_topic_id;
  if v_count <> 1 then
    reset role;
    raise exception 'SELF-TEST FAIL: attendee message did not land';
  end if;
  reset role;
  if not exists (select 1 from public.community_topic_members
                 where topic_id = v_topic_id and user_id = v_attendee) then
    raise exception 'SELF-TEST FAIL: RSVP did not create the chat membership';
  end if;

  -- 8d. the attendee cannot see ORDINARY community topics or the wider club
  insert into public.community_topics (community_id, name, created_by)
  values (v_cid, 'members only room', v_creator);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.community_topics
  where community_id = v_cid and explore_event_id is null;
  if v_count <> 0 then
    reset role;
    raise exception 'SELF-TEST FAIL: attendee can see member-only topics';
  end if;
  reset role;

  -- 8e. the attendee shows up in the cards RPC as an attendee topic.
  --     Assertions SEARCH (never index or count): the test trio are real
  --     users who may hold real memberships, and the backfill may have
  --     seeded real attendee topics.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  v_payload := public.get_my_community_chat_cards();
  if not exists (
    select 1 from jsonb_array_elements(v_payload->'attendee_topics') at_topic
    where at_topic->>'id' = v_topic_id::text
  ) then
    raise exception 'SELF-TEST FAIL: attendee topic missing from the cards payload';
  end if;
  -- and a member sees the event topic inside their card, never as attendee
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  v_payload := public.get_my_community_chat_cards();
  if exists (
    select 1 from jsonb_array_elements(v_payload->'attendee_topics') at_topic
    where at_topic->>'id' = v_topic_id::text
  ) then
    raise exception 'SELF-TEST FAIL: a community member leaked into attendee topics';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(v_payload->'cards') card,
         jsonb_array_elements(card->'topics') topic
    where topic->>'id' = v_topic_id::text
  ) then
    raise exception 'SELF-TEST FAIL: event topic missing from the member card';
  end if;

  -- 8f. cancelling the RSVP takes the attendee out (call b)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.explore_event_rsvps set status = 'cancelled'
  where explore_event_id = v_eid and user_id = v_attendee;
  reset role;
  if exists (select 1 from public.community_topic_members
             where topic_id = v_topic_id and user_id = v_attendee) then
    raise exception 'SELF-TEST FAIL: cancel did not remove the chat membership';
  end if;

  -- 8f2. deleting the RSVP row outright leaves no ghost attendee (Cowork fix)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.explore_event_rsvps set status = 'going'
  where explore_event_id = v_eid and user_id = v_attendee;
  reset role;
  if not exists (select 1 from public.community_topic_members
                 where topic_id = v_topic_id and user_id = v_attendee) then
    raise exception 'SELF-TEST FAIL: re-going did not restore the chat membership';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.explore_event_rsvps
  where explore_event_id = v_eid and user_id = v_attendee;
  reset role;
  if exists (select 1 from public.community_topic_members
             where topic_id = v_topic_id and user_id = v_attendee) then
    raise exception 'SELF-TEST FAIL: deleting the RSVP left a ghost attendee';
  end if;

  -- 8g. the archive cron exists and cancel archives the chat immediately
  if not exists (select 1 from cron.job where jobname = 'archive-community-event-topics') then
    raise exception 'SELF-TEST FAIL: archive cron job missing';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  perform public.operator_update_explore_event(
    p_event_id => v_eid,
    p_title => 'Selftest Sunset Watch',
    p_event_date => to_char(current_date + 7, 'YYYY-MM-DD'),
    p_category => 'community',
    p_pin_to_chat => true,
    p_status => 'Cancelled'
  );
  if not exists (select 1 from public.community_topics where id = v_topic_id and archived) then
    raise exception 'SELF-TEST FAIL: cancelling the event did not archive its chat';
  end if;

  -- 8h. the stale RPC overloads are gone (PostgREST cannot mis-route)
  select count(*) into v_count from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operator_create_explore_event';
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: expected exactly one operator_create overload, found %', v_count;
  end if;
  select count(*) into v_count from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operator_update_explore_event';
  if v_count <> 1 then
    raise exception 'SELF-TEST FAIL: expected exactly one operator_update overload, found %', v_count;
  end if;

  -- cleanup: events and grant are ours; the community cascades the rest
  delete from public.explore_event_rsvps where explore_event_id in (v_eid, v_standalone_eid);
  delete from public.explore_events where id in (v_eid, v_standalone_eid);
  delete from public.operator_grants where id = v_grant_id;
  delete from public.communities where id = v_cid;

  raise notice 'event chat model self-test passed';
end;
$$;

commit;
