-- ============================================================================
-- 20: EVENT TEMPLATES + OPERATOR EVENT DRAFTS
-- Cowork APPROVED 7-08 with one fix (full privilege pattern on the new
-- create overload: revoke from public AND anon, grant authenticated, plus
-- the has_function_privilege anon assertion) and one nit (50KB cap on
-- template fields). Applied on the go as
-- supabase/migrations/20260708200000_templates_and_drafts.sql.
--
-- Why: the creator tools queue (Liz 7-08). Duplicate-event shipped client-only;
-- save-as-template needs storage, and creator event drafts need the publish
-- seam (operator events currently publish straight to Live, and the event
-- chat is born inside operator_create). Two seams, one batch.
--
-- DELIBERATE CALLS (accept or push back):
-- a. TEMPLATES ARE A TABLE, NOT A STATUS. A template row stores the form's
--    field set as jsonb (the client OperatorEventFields shape) — it is NOT an
--    explore_events row, so it can never leak into discovery, never gets a
--    chat, never hits the archive cron. Direct table access through RLS,
--    owner-only on every verb; no RPC needed.
-- b. OWNER-ONLY, NOT GRANT-GATED: any authed user could technically insert a
--    template for themselves; only creators can reach the UI, and a template
--    is inert (publishing still goes through the grant-gated RPCs). Keeping
--    RLS simple beats a redundant grant check.
-- c. DRAFTS ARE STATUS 'Draft' ON explore_events: operator_create gains
--    p_publish boolean default true. false => status 'Draft' and NO event
--    topic. The chat is born at PUBLISH (the 7-07 model, now honest for
--    drafts too): operator_update creates the topic on the Draft -> Live
--    flip. Discovery, the archive cron, and the pinned card all key on
--    status 'Live' + topics, so drafts are invisible everywhere by
--    construction; owner-read RLS (batch 15) already shows creators their
--    own non-Live rows.
-- d. A DRAFT CANNOT BE COMPLETED OR CANCELLED (friendly refusal): it goes
--    Live or it gets edited. Deleting drafts is a later conversation (no
--    operator delete RPC exists for explore_events at all).
-- e. STALE-OVERLOAD HYGIENE: operator_create changes signature (gains
--    p_publish), so the old 13-arg overload is DROPPED first (the PostgREST
--    routing landmine from batch 18). operator_update keeps its signature
--    (create or replace in place).
-- f. 'Draft' capitalization matches the existing free-text status family
--    ('Live', 'Completed', 'Cancelled').
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. templates table (owner-only RLS, all verbs)
-- ----------------------------------------------------------------------------
create table public.operator_event_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  community_id uuid references public.communities (id) on delete set null,
  name text not null constraint operator_event_templates_name_len
    check (char_length(btrim(name)) between 1 and 80),
  fields jsonb not null constraint operator_event_templates_fields_size
    check (pg_column_size(fields) <= 51200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operator_event_templates enable row level security;

create policy operator_event_templates_select on public.operator_event_templates
  for select using (user_id = auth.uid());
create policy operator_event_templates_insert on public.operator_event_templates
  for insert with check (user_id = auth.uid());
create policy operator_event_templates_update on public.operator_event_templates
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy operator_event_templates_delete on public.operator_event_templates
  for delete using (user_id = auth.uid());

revoke all on public.operator_event_templates from anon;
grant select, insert, update, delete on public.operator_event_templates to authenticated;

-- ----------------------------------------------------------------------------
-- 2. operator_create_explore_event v3: p_publish (drop the stale overload, call e)
-- ----------------------------------------------------------------------------
drop function if exists public.operator_create_explore_event(
  text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean);

create function public.operator_create_explore_event(
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
  p_pin_to_chat boolean default true,
  p_publish boolean default true
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- the chat is born at PUBLISH: a draft gets no topic (call c)
  if coalesce(p_publish, true) and p_community_id is not null then
    insert into community_topics (community_id, name, created_by, explore_event_id)
    values (p_community_id, left(btrim(p_title), 60), v_uid, v_id);
  end if;

  return v_id;
end;
$function$;

revoke all on function public.operator_create_explore_event(
  text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.operator_create_explore_event(
  text, text, text, text, timestamptz, text, text, text, text, text, uuid, text, boolean, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. operator_update_explore_event v3: the Draft -> Live publish flip
--    Signature unchanged (create or replace in place). Changes from live:
--    v_row also reads status; a Draft refuses Completed/Cancelled (call d);
--    publishing a community draft creates its topic at that moment.
-- ----------------------------------------------------------------------------
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
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- LIZ COPY (call d)
    raise exception 'This one is still a draft. Publish it or keep shaping it.';
  end if;
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

  -- publish flip: the event chat is born NOW (call c); the partial unique
  -- index (one topic per event) makes a double-publish a clean no-op
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

-- ============================================================================
-- SELF-TESTS (in-transaction, NEVER strip on apply)
-- ============================================================================
do $selftest$
declare
  v_creator uuid;
  v_other uuid;
  v_cid uuid;
  v_eid uuid;
  v_live_eid uuid;
  v_tpl uuid;
  v_n int;
  v_status text;
begin
  -- a real non-admin user gets a temp grant + community (all rolled back /
  -- cleaned); a second user probes RLS
  select u.id into v_creator from auth.users u
  where not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  select u.id into v_other from auth.users u
  where u.id <> v_creator
    and not exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'admin')
  order by u.created_at limit 1;
  if v_creator is null or v_other is null then
    raise exception 'selftest: need 2 non-admin users';
  end if;

  insert into operator_grants (user_id, track, status, application, terms_accepted_at)
  values (v_creator, 'community_leader', 'approved', '{"selftest":20}'::jsonb, now());
  insert into communities (name, handle, status, created_by)
  values ('selftest drafts club', 'selftest-drafts-club-20', 'active', v_creator)
  returning id into v_cid;
  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_cid, v_creator, 'leader', 'active', now() - interval '1 hour');

  -- 1. template CRUD + RLS probe
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into operator_event_templates (user_id, community_id, name, fields)
  values (v_creator, v_cid, 'selftest template 20', '{"title":"beach night","category":"community"}'::jsonb)
  returning id into v_tpl;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from operator_event_templates where id = v_tpl;
  if v_n <> 0 then
    reset role;
    raise exception 'selftest: template visible to another user';
  end if;
  begin
    insert into operator_event_templates (user_id, name, fields)
    values (v_creator, 'forged', '{}'::jsonb);
    reset role;
    raise exception 'selftest: template forged for another user';
  exception when insufficient_privilege or check_violation then
    reset role;
  end;

  -- 1b. the phase-1 gotcha assertion: anon must NOT hold execute on either
  -- operator RPC (the PUBLIC default grant is the trap)
  if has_function_privilege('anon',
    'public.operator_create_explore_event(text,text,text,text,timestamptz,text,text,text,text,text,uuid,text,boolean,boolean)',
    'execute') then
    raise exception 'selftest: anon can execute operator_create_explore_event';
  end if;
  if has_function_privilege('anon',
    'public.operator_update_explore_event(uuid,text,text,text,text,timestamptz,text,text,text,text,text,text,boolean,text)',
    'execute') then
    raise exception 'selftest: anon can execute operator_update_explore_event';
  end if;

  -- 1c. a novel does not fit (50KB fields cap)
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into operator_event_templates (user_id, name, fields)
    values (v_creator, 'oversize', jsonb_build_object('pad', repeat('x', 60000)));
    reset role;
    raise exception 'selftest: oversize template accepted';
  exception when check_violation then
    reset role;
  end;

  -- 2. draft create: status Draft, NO topic
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_eid := operator_create_explore_event(
    p_title => 'selftest draft event 20', p_category => 'community',
    p_event_date => '2099-01-01', p_community_id => v_cid, p_publish => false);
  reset role;
  select status into v_status from explore_events where id = v_eid;
  if v_status <> 'Draft' then
    raise exception 'selftest: draft status wrong: %', v_status;
  end if;
  if exists (select 1 from community_topics where explore_event_id = v_eid) then
    raise exception 'selftest: draft grew a topic';
  end if;

  -- 3. draft invisible to anon (public read policy is Live-only)
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) into v_n from explore_events where id = v_eid;
  reset role;
  if v_n <> 0 then
    raise exception 'selftest: draft visible to anon';
  end if;

  -- 4. editing a draft (p_status null) keeps it a draft
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform operator_update_explore_event(
    p_event_id => v_eid, p_title => 'selftest draft event 20 renamed',
    p_category => 'community', p_event_date => '2099-01-01');
  reset role;
  select status into v_status from explore_events where id = v_eid;
  if v_status <> 'Draft' then
    raise exception 'selftest: edit flipped draft status to %', v_status;
  end if;

  -- 5. a draft refuses Completed/Cancelled (call d)
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform operator_update_explore_event(
      p_event_id => v_eid, p_title => 'x', p_category => 'community', p_status => 'Cancelled');
    reset role;
    raise exception 'selftest: draft accepted Cancelled';
  exception when raise_exception then
    reset role;
    if sqlerrm not like '%still a draft%' and sqlerrm not like '%selftest: draft accepted%' then
      raise exception 'selftest: unexpected error on draft cancel: %', sqlerrm;
    end if;
    if sqlerrm like '%selftest: draft accepted%' then
      raise exception '%', sqlerrm;
    end if;
  end;

  -- 6. publish flip: Live + topic born now; double publish = no dup topic
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform operator_update_explore_event(
    p_event_id => v_eid, p_title => 'selftest draft event 20 renamed',
    p_category => 'community', p_event_date => '2099-01-01', p_status => 'Live');
  perform operator_update_explore_event(
    p_event_id => v_eid, p_title => 'selftest draft event 20 renamed',
    p_category => 'community', p_event_date => '2099-01-01', p_status => 'Live');
  reset role;
  select status into v_status from explore_events where id = v_eid;
  if v_status <> 'Live' then
    raise exception 'selftest: publish flip failed: %', v_status;
  end if;
  select count(*) into v_n from community_topics where explore_event_id = v_eid;
  if v_n <> 1 then
    raise exception 'selftest: expected exactly 1 topic after publish, got %', v_n;
  end if;

  -- 7. default create still publishes Live with its topic (regression)
  perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_live_eid := operator_create_explore_event(
    p_title => 'selftest live event 20', p_category => 'community',
    p_event_date => '2099-01-02', p_community_id => v_cid);
  reset role;
  select status into v_status from explore_events where id = v_live_eid;
  if v_status <> 'Live' then
    raise exception 'selftest: default create not Live: %', v_status;
  end if;
  select count(*) into v_n from community_topics where explore_event_id = v_live_eid;
  if v_n <> 1 then
    raise exception 'selftest: default create topic missing';
  end if;

  -- cleanup (fixture rows only)
  delete from operator_event_templates where id = v_tpl;
  delete from community_topics where community_id = v_cid;
  delete from explore_events where id in (v_eid, v_live_eid);
  delete from community_members where community_id = v_cid;
  delete from communities where id = v_cid;
  delete from operator_grants where user_id = v_creator and application = '{"selftest":20}'::jsonb;

  raise notice 'selftest 20: ALL PASSED';
end;
$selftest$;
