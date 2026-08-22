-- Creator-seeded welcome message for event chat (CTO spec item 04: "The
-- creator may seed a welcome message"). It becomes the topic's real first
-- message, attributed to the creator, using community_topic_messages'
-- existing NOT NULL sender_id + 1..4000 char body constraint as-is.
--
-- Deliberately NOT implemented by touching operator_create_explore_event:
-- that RPC's live signature has already drifted from every migration file
-- in this repo (confirmed by 20260817130000_explore_event_rsvp_capacity.sql's
-- own RISK B note -- lib/creatorEvents.ts calls it today with p_end_time and
-- p_description_blocks, neither tracked in any migration file here).
-- Redeclaring it without first reading the TRUE live signature via
-- `select pg_get_functiondef('public.operator_create_explore_event'::regproc)`
-- against the real database would risk silently dropping those live params.
-- This migration is instead a small, fully standalone, additive RPC with
-- zero surface overlap with that function.
--
-- NOT YET APPLIED to any database. File + self-test only -- applying is a
-- separate approval.

begin;

create or replace function public.set_event_chat_welcome_message(
  p_event_id uuid,
  p_message text
)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_topic_id uuid;
  v_message text;
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

  v_message := nullif(btrim(p_message), '');
  if v_message is null then
    raise exception 'Welcome message cannot be blank.';
  end if;
  if char_length(v_message) > 4000 then
    raise exception 'Welcome message is too long (4000 characters max).';
  end if;

  select id into v_topic_id from community_topics where explore_event_id = p_event_id;
  if v_topic_id is null then
    raise exception 'This event has no chat yet (standalone events never get one).';
  end if;

  -- "the first message" -- only while the room is still genuinely empty, so
  -- this can never be used to inject a message into a chat people are
  -- already using, and never stacks a second "welcome" on top of a first.
  if exists (select 1 from community_topic_messages where topic_id = v_topic_id) then
    raise exception 'This chat already has messages -- a welcome message can only be set before anyone has spoken.' using errcode = 'check_violation';
  end if;

  insert into community_topic_messages (topic_id, sender_id, body)
  values (v_topic_id, v_uid, v_message);
end;
$$;

revoke all on function public.set_event_chat_welcome_message(uuid, text) from public;
revoke all on function public.set_event_chat_welcome_message(uuid, text) from anon;
grant execute on function public.set_event_chat_welcome_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- self-test (never strip on apply)
-- ---------------------------------------------------------------------------
do $$
declare
  v_creator uuid;
  v_other uuid;
  v_cid uuid;
  v_eid uuid;
  v_topic_id uuid;
  v_grant_id uuid;
  v_body text;
  v_raised boolean;
begin
  select id into v_creator from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_other from auth.users u
  where u.id <> v_creator
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_creator is null or v_other is null then
    raise exception 'SELF-TEST FAIL: needs two existing non-admin users';
  end if;

  insert into public.communities (handle, name, created_by, status)
  values ('selftest-welcome-msg', 'Welcome Msg Selftest', v_creator, 'active')
  returning id into v_cid;
  insert into public.community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_creator, 'leader', 'active', now() - interval '1 hour');
  insert into public.operator_grants (user_id, track, status, application)
  values (v_creator, 'community_leader', 'approved', '{}'::jsonb)
  returning id into v_grant_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  v_eid := public.operator_create_explore_event(
    p_title => 'Selftest Welcome Event',
    p_event_date => to_char(current_date + 7, 'YYYY-MM-DD'),
    p_category => 'community',
    p_community_id => v_cid
  );
  select id into v_topic_id from public.community_topics where explore_event_id = v_eid;
  if v_topic_id is null then
    raise exception 'SELF-TEST FAIL: event chat not born at publish';
  end if;

  -- a) a non-owner cannot seed the welcome message
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_event_chat_welcome_message(v_eid, 'not yours to say');
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a non-owner set the welcome message';
  end if;

  -- b) the creator can seed it, trimmed, attributed to them
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.set_event_chat_welcome_message(v_eid, '  Welcome! So glad you are coming.  ');
  reset role;
  select body into v_body from public.community_topic_messages
  where topic_id = v_topic_id order by created_at limit 1;
  if v_body is distinct from 'Welcome! So glad you are coming.' then
    raise exception 'SELF-TEST FAIL: welcome message missing or not trimmed, got %', v_body;
  end if;
  if not exists (select 1 from public.community_topic_messages where topic_id = v_topic_id and sender_id = v_creator) then
    raise exception 'SELF-TEST FAIL: welcome message not attributed to the creator';
  end if;

  -- c) cannot seed a second welcome message once the chat has any message
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_event_chat_welcome_message(v_eid, 'a second one');
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a second welcome message was accepted after the chat already had one';
  end if;

  -- d) blank message is rejected friendly, on a fresh empty-chat event
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  v_eid := public.operator_create_explore_event(
    p_title => 'Selftest Blank Welcome',
    p_event_date => to_char(current_date + 7, 'YYYY-MM-DD'),
    p_category => 'community',
    p_community_id => v_cid
  );
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_event_chat_welcome_message(v_eid, '   ');
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a blank welcome message was accepted';
  end if;

  delete from public.community_topic_messages where topic_id in (
    select id from public.community_topics where community_id = v_cid);
  delete from public.explore_event_rsvps where explore_event_id in (
    select id from public.explore_events where community_id = v_cid);
  delete from public.explore_events where community_id = v_cid;
  delete from public.operator_grants where id = v_grant_id;
  delete from public.communities where id = v_cid;

  raise notice 'event chat welcome message self-test passed';
end;
$$;

commit;
