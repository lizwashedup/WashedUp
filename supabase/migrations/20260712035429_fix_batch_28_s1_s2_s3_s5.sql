-- Batch 28 (the fix batch schema): S1 RSVP-only event topics, S2 reserved
-- handles, S3 past-event roll-off cron, S5 publish-requires-a-date.
-- Cowork-approved 2026-07-11 (one amendment: idempotent trigger create);
-- applied to prod on Liz's go as version 20260712035429, all in-transaction
-- self-tests passing. Full proposal history and deliberate calls a-k in
-- Events_Communities/28-fix-batch-schema-proposal.sql.
--
-- APPLY-ORDER CONSTRAINT: this migration applied BEFORE the house or
-- contributor community was seeded (self-tests 4 and 7 take the literal
-- reserved handles and communities.handle is UNIQUE). It cannot re-run
-- after seeding without editing those two tests. Never reshuffle.

-- ----------------------------------------------------------------------------
-- S1: RSVP is the only door into an event topic
-- ----------------------------------------------------------------------------

drop policy community_topic_members_insert on public.community_topic_members;

create policy community_topic_members_insert on public.community_topic_members
  for insert
  with check (
    (user_id = (select auth.uid()))
    and exists (
      select 1
      from public.community_topics t
      where t.id = community_topic_members.topic_id
        and not t.archived
        and t.explore_event_id is null
        and public.is_community_member(t.community_id, (select auth.uid()))
    )
  );

comment on policy community_topic_members_insert on public.community_topic_members is
  'Active members may self-join unarchived ROOMS only. Event topics (explore_event_id set) are attendance-scoped: the RSVP trigger (security definer) is the only door, for members and non-members alike. Narrowed 2026-07-11 (batch 28, S1).';

-- ----------------------------------------------------------------------------
-- S2: the house handles are un-assignable
-- ----------------------------------------------------------------------------

create or replace function public.enforce_reserved_community_handle()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.handle is null then
    return new;
  end if;
  if lower(new.handle) in ('washedup', 'contributors') then
    -- the house-community seeding paths pass: straight SQL / service role
    -- (no auth uid) or an admin acting as themselves. everyone else is out.
    if auth.uid() is null
       or public.is_admin(auth.uid())
       or public.has_role(auth.uid(), 'admin'::app_role) then
      return new;
    end if;
    raise exception 'That handle is reserved.';
  end if;
  return new;
end;
$$;

-- Cowork amendment 2026-07-11: the cron block is idempotent on re-apply but
-- trigger creation is not; this makes the whole file honest about it.
drop trigger if exists enforce_reserved_community_handle_trigger on public.communities;

create trigger enforce_reserved_community_handle_trigger
  before insert or update of handle on public.communities
  for each row execute function public.enforce_reserved_community_handle();

-- ----------------------------------------------------------------------------
-- S3: past events read completed and roll off
-- ----------------------------------------------------------------------------

create or replace function public.auto_complete_past_explore_events()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  update explore_events e
  set status = 'Completed', updated_at = now()
  where e.status = 'Live'
    and coalesce(
          e.end_time,
          e.start_time,
          ((e.event_date + 1)::timestamp at time zone 'America/Los_Angeles')
        ) < now() - interval '6 hours';
  get diagnostics v_count = row_count;
  return jsonb_build_object('completed_count', v_count, 'run_at', now());
end;
$$;

revoke all on function public.auto_complete_past_explore_events() from public;
revoke all on function public.auto_complete_past_explore_events() from anon;
revoke all on function public.auto_complete_past_explore_events() from authenticated;

do $cron$
declare
  v_jobid integer;
begin
  select jobid into v_jobid from cron.job
  where jobname = 'auto-complete-past-explore-events';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule(
    'auto-complete-past-explore-events',
    '7 * * * *',
    'select public.auto_complete_past_explore_events();'
  );
end;
$cron$;

-- ----------------------------------------------------------------------------
-- S5: publishing an event requires a date (server half of C9)
-- Recreates our operator RPCs with the guard added right after the category
-- guard; every other line is byte-identical to the live definitions (read
-- from prod 2026-07-11).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.operator_create_explore_event(p_title text, p_description text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_event_date text DEFAULT NULL::text, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_venue text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_external_url text DEFAULT NULL::text, p_ticket_price text DEFAULT NULL::text, p_community_id uuid DEFAULT NULL::uuid, p_public_name text DEFAULT NULL::text, p_pin_to_chat boolean DEFAULT true, p_publish boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if coalesce(btrim(p_category), '') = '' then
    raise exception 'Pick a category.';
  end if;
  -- S5: a dateless event can be a draft, never Live (LIZ COPY guard)
  if coalesce(p_publish, true) and coalesce(btrim(p_event_date), '') = '' then
    raise exception 'Pick a date.';
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
    case when coalesce(p_publish, true) then 'Live' else 'Draft' end
  ) returning id into v_id;

  -- the chat is born at PUBLISH: a draft gets no topic
  if coalesce(p_publish, true) and p_community_id is not null then
    insert into community_topics (community_id, name, created_by, explore_event_id)
    values (p_community_id, left(btrim(p_title), 60), v_uid, v_id);
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.operator_update_explore_event(p_event_id uuid, p_title text, p_description text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_event_date text DEFAULT NULL::text, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_venue text DEFAULT NULL::text, p_venue_address text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_external_url text DEFAULT NULL::text, p_ticket_price text DEFAULT NULL::text, p_public_name text DEFAULT NULL::text, p_pin_to_chat boolean DEFAULT true, p_status text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, host_user_id, community_id, status into v_row
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
  if v_row.status = 'Draft' and p_status in ('Completed', 'Cancelled') then
    -- LIZ COPY
    raise exception 'This one is still a draft. Publish it or keep shaping it.';
  end if;
  if coalesce(btrim(p_category), '') = '' then
    raise exception 'Pick a category.';
  end if;
  -- S5: Live (asked for or carried through the full overwrite) keeps a date;
  -- this also blocks blanking the date on a Live event. Cancel/complete of a
  -- dateless legacy row stays allowed. (LIZ COPY guard)
  if coalesce(p_status, v_row.status) = 'Live'
     and coalesce(btrim(p_event_date), '') = '' then
    raise exception 'Pick a date.';
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

  -- publish flip: the event chat is born NOW; the partial unique index
  -- (one topic per event) makes a double-publish a clean no-op
  if v_row.status = 'Draft' and p_status = 'Live' and v_row.community_id is not null then
    insert into community_topics (community_id, name, created_by, explore_event_id)
    values (v_row.community_id, left(btrim(p_title), 60), v_uid, p_event_id)
    on conflict (explore_event_id) where explore_event_id is not null do nothing;
  end if;

  update community_topics
  set name = left(btrim(p_title), 60),
      archived = archived or coalesce(p_status, '') in ('Cancelled', 'Completed')
  where explore_event_id = p_event_id;
end;
$function$;

-- ----------------------------------------------------------------------------
-- SELF-TEST (in-transaction, cleans up after itself, never stripped)
-- ----------------------------------------------------------------------------

do $selftest$
declare
  v_admin_role text := current_user;
  v_liz uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';
  v_sage uuid := 'cafe0001-0000-0000-0000-000000000001';
  v_comm uuid;
  v_room uuid;
  v_event_live_future uuid;
  v_event_topic uuid;
  v_ev_past_live uuid;
  v_ev_future_live uuid;
  v_ev_past_draft uuid;
  v_ev_past_cancelled uuid;
  v_ev_dateonly_past uuid;
  v_ev_dateless uuid;
  v_ev_s5_draft uuid;
  v_ev_s5_legacy uuid;
  v_result jsonb;
  v_status text;
  v_n integer;
begin
  -- ---------- fixtures (as the migration role, RLS bypassed) ----------
  insert into communities (handle, name, created_by)
  values ('selftest-batch28', 'selftest batch28', v_liz)
  returning id into v_comm;

  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_comm, v_sage, 'leader', 'active', now());

  insert into community_topics (community_id, name, created_by)
  values (v_comm, 'selftest room', v_sage)
  returning id into v_room;

  insert into explore_events (title, category, status, community_id, event_date, start_time)
  values ('selftest batch28 rsvp event', 'community', 'Live', v_comm,
          (now() + interval '10 days')::date, now() + interval '10 days')
  returning id into v_event_live_future;

  insert into community_topics (community_id, name, explore_event_id)
  values (v_comm, 'selftest batch28 rsvp event', v_event_live_future)
  returning id into v_event_topic;

  -- ---------- S1 tests, under the real authenticated role as Sage ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1. a member self-joins a normal room: still allowed (C5 relies on this)
  insert into community_topic_members (topic_id, user_id)
  values (v_room, v_sage);

  -- 2. a member self-joins an EVENT topic: refused by the narrowed policy
  begin
    insert into community_topic_members (topic_id, user_id)
    values (v_event_topic, v_sage);
    raise exception 'SELFTEST FAIL S1: member self-inserted into an event topic';
  exception
    when insufficient_privilege then null; -- 42501, the wanted refusal
  end;

  -- 3. the RSVP door still works end to end as a real user: the definer
  --    trigger inserts the membership despite the narrowed policy
  insert into explore_event_rsvps (explore_event_id, user_id, status)
  values (v_event_live_future, v_sage, 'going');

  perform set_config('role', v_admin_role, true);

  select count(*) into v_n from community_topic_members
  where topic_id = v_event_topic and user_id = v_sage;
  if v_n <> 1 then
    raise exception 'SELFTEST FAIL S1: RSVP trigger no longer seats the attendee (got % rows)', v_n;
  end if;

  -- un-RSVP by row delete removes the seat (the delete branch, unchanged)
  delete from explore_event_rsvps
  where explore_event_id = v_event_live_future and user_id = v_sage;
  select count(*) into v_n from community_topic_members
  where topic_id = v_event_topic and user_id = v_sage;
  if v_n <> 0 then
    raise exception 'SELFTEST FAIL S1: un-RSVP left a ghost attendee';
  end if;

  -- ---------- S2 tests ----------
  -- 4. no-auth path (straight SQL seeding) may take a house handle.
  --    clear the jwt claims left over from the S1 section first: a real
  --    seeding session has none (proven by dry-run 1, which failed here
  --    exactly because Sage's claims were still set, incidentally proving
  --    the trigger blocks a non-admin on a direct insert too)
  perform set_config('request.jwt.claims', '', true);
  insert into communities (handle, name, created_by)
  values ('washedup', 'selftest house probe', v_liz);
  delete from communities where handle = 'washedup' and name = 'selftest house probe';

  -- 5. a normal leader cannot rename onto a house handle
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update communities set handle = 'contributors' where id = v_comm;
    raise exception 'SELFTEST FAIL S2: leader claimed a reserved handle';
  exception
    when raise_exception then
      if sqlerrm not like '%reserved%' then
        raise exception 'SELFTEST FAIL S2: wrong refusal: %', sqlerrm;
      end if;
  end;

  -- 6. a normal rename still passes for the leader
  update communities set handle = 'selftest-batch28-renamed' where id = v_comm;

  perform set_config('role', v_admin_role, true);

  -- 7. the admin escape: Liz (is_admin) may take a house handle
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_liz, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update communities set handle = 'contributors' where id = v_comm;
  perform set_config('role', v_admin_role, true);
  update communities set handle = 'selftest-batch28' where id = v_comm;

  -- ---------- S3 tests ----------
  insert into explore_events (title, category, status, event_date, start_time)
  values ('selftest s3 past live', 'community',
          'Live', (now() - interval '2 days')::date, now() - interval '2 days')
  returning id into v_ev_past_live;
  insert into explore_events (title, category, status, event_date, start_time)
  values ('selftest s3 future live', 'community',
          'Live', (now() + interval '2 days')::date, now() + interval '2 days')
  returning id into v_ev_future_live;
  insert into explore_events (title, category, status, event_date, start_time)
  values ('selftest s3 past draft', 'community',
          'Draft', (now() - interval '2 days')::date, now() - interval '2 days')
  returning id into v_ev_past_draft;
  insert into explore_events (title, category, status, event_date, start_time)
  values ('selftest s3 past cancelled', 'community',
          'Cancelled', (now() - interval '2 days')::date, now() - interval '2 days')
  returning id into v_ev_past_cancelled;
  -- date-only, two LA days back: past even at end-of-day plus grace
  insert into explore_events (title, category, status, event_date)
  values ('selftest s3 dateonly past', 'community',
          'Live', ((now() at time zone 'America/Los_Angeles')::date - 2))
  returning id into v_ev_dateonly_past;
  -- no date, no time: must never complete (C9 flags these client-side)
  insert into explore_events (title, category, status)
  values ('selftest s3 dateless', 'community', 'Live')
  returning id into v_ev_dateless;

  select public.auto_complete_past_explore_events() into v_result;
  raise notice 'SELFTEST S3: auto-complete ran, %', v_result;

  select status into v_status from explore_events where id = v_ev_past_live;
  if v_status <> 'Completed' then
    raise exception 'SELFTEST FAIL S3: past Live not completed (%)', v_status;
  end if;
  select status into v_status from explore_events where id = v_ev_dateonly_past;
  if v_status <> 'Completed' then
    raise exception 'SELFTEST FAIL S3: date-only past Live not completed (%)', v_status;
  end if;
  select status into v_status from explore_events where id = v_ev_future_live;
  if v_status <> 'Live' then
    raise exception 'SELFTEST FAIL S3: future Live was touched (%)', v_status;
  end if;
  select status into v_status from explore_events where id = v_ev_past_draft;
  if v_status <> 'Draft' then
    raise exception 'SELFTEST FAIL S3: Draft was touched (%)', v_status;
  end if;
  select status into v_status from explore_events where id = v_ev_past_cancelled;
  if v_status <> 'Cancelled' then
    raise exception 'SELFTEST FAIL S3: Cancelled was touched (%)', v_status;
  end if;
  select status into v_status from explore_events where id = v_ev_dateless;
  if v_status <> 'Live' then
    raise exception 'SELFTEST FAIL S3: dateless row was touched (%)', v_status;
  end if;

  -- 8. cron wired
  select count(*) into v_n from cron.job
  where jobname = 'auto-complete-past-explore-events';
  if v_n <> 1 then
    raise exception 'SELFTEST FAIL S3: cron job not scheduled (found %)', v_n;
  end if;

  -- 9. privileges: anon and authenticated cannot execute the new function
  if has_function_privilege('anon', 'public.auto_complete_past_explore_events()', 'execute') then
    raise exception 'SELFTEST FAIL S3: anon can execute the completion function';
  end if;
  if has_function_privilege('authenticated', 'public.auto_complete_past_explore_events()', 'execute') then
    raise exception 'SELFTEST FAIL S3: authenticated can execute the completion function';
  end if;

  -- ---------- S5 tests, as Liz (holds the community_leader grant) ----------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_liz, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 10. publishing without a date refuses with the friendly guard
  begin
    perform operator_create_explore_event(
      p_title => 'selftest s5 dateless publish', p_category => 'community');
    raise exception 'SELFTEST FAIL S5: dateless event published to Live';
  exception
    when raise_exception then
      if sqlerrm <> 'Pick a date.' then
        raise exception 'SELFTEST FAIL S5: wrong refusal: %', sqlerrm;
      end if;
  end;

  -- 11. a dateless DRAFT is still legal
  select operator_create_explore_event(
    p_title => 'selftest s5 dateless draft', p_category => 'community',
    p_publish => false) into v_ev_s5_draft;

  -- 12. flipping that draft to Live without a date refuses
  begin
    perform operator_update_explore_event(
      p_event_id => v_ev_s5_draft, p_title => 'selftest s5 dateless draft',
      p_category => 'community', p_status => 'Live');
    raise exception 'SELFTEST FAIL S5: dateless draft published to Live';
  exception
    when raise_exception then
      if sqlerrm <> 'Pick a date.' then
        raise exception 'SELFTEST FAIL S5: wrong publish refusal: %', sqlerrm;
      end if;
  end;

  -- 13. with a date the same flip goes through
  perform operator_update_explore_event(
    p_event_id => v_ev_s5_draft, p_title => 'selftest s5 dateless draft',
    p_category => 'community', p_status => 'Live',
    p_event_date => to_char((now() + interval '5 days'), 'YYYY-MM-DD'));
  select status into v_status from explore_events where id = v_ev_s5_draft;
  if v_status <> 'Live' then
    raise exception 'SELFTEST FAIL S5: dated publish did not go Live (%)', v_status;
  end if;

  -- 14. blanking the date on a Live event refuses (full-overwrite hazard)
  begin
    perform operator_update_explore_event(
      p_event_id => v_ev_s5_draft, p_title => 'selftest s5 dateless draft',
      p_category => 'community');
    raise exception 'SELFTEST FAIL S5: Live event date blanked';
  exception
    when raise_exception then
      if sqlerrm <> 'Pick a date.' then
        raise exception 'SELFTEST FAIL S5: wrong blanking refusal: %', sqlerrm;
      end if;
  end;

  -- 15. cancelling a dateless LEGACY Live row still works (the tour's cancel
  --     path). Seeded directly: the RPC can no longer create one, by design.
  perform set_config('role', v_admin_role, true);
  insert into explore_events (title, category, status, host_user_id)
  values ('selftest s5 dateless legacy', 'community', 'Live', v_liz)
  returning id into v_ev_s5_legacy;
  perform set_config('role', 'authenticated', true);
  perform operator_update_explore_event(
    p_event_id => v_ev_s5_legacy, p_title => 'selftest s5 dateless legacy',
    p_category => 'community', p_status => 'Cancelled');
  perform set_config('role', v_admin_role, true);
  select status into v_status from explore_events where id = v_ev_s5_legacy;
  if v_status <> 'Cancelled' then
    raise exception 'SELFTEST FAIL S5: dateless legacy cancel refused (%)', v_status;
  end if;

  -- ---------- cleanup ----------
  delete from explore_events where id in (v_ev_s5_draft, v_ev_s5_legacy);
  delete from community_topic_members where topic_id in (v_room, v_event_topic);
  delete from community_topics where id in (v_room, v_event_topic);
  delete from explore_events where id in
    (v_event_live_future, v_ev_past_live, v_ev_future_live, v_ev_past_draft,
     v_ev_past_cancelled, v_ev_dateonly_past, v_ev_dateless);
  delete from community_members where community_id = v_comm;
  delete from communities where id = v_comm;

  select count(*) into v_n from communities where handle like 'selftest-batch28%';
  if v_n <> 0 then
    raise exception 'SELFTEST FAIL: fixture communities left behind (%)', v_n;
  end if;
  select count(*) into v_n from explore_events where title like 'selftest %';
  if v_n <> 0 then
    raise exception 'SELFTEST FAIL: fixture events left behind (%)', v_n;
  end if;

  raise notice 'SELFTEST batch 28 (S1+S2+S3): all assertions passed';
end;
$selftest$;
