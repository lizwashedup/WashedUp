-- 36: minimal organizer profile (Liz's addendum, applied 2026-07-13 on her go
-- as prod migration 20260713224144, after Cowork review + probe amendment +
-- fresh ROLLBACK dry-run). One table: world read, owner-write creator-gated.
-- A profile, not a platform. Proposal doc: Events_Communities/36.


-- 1. the table
create table if not exists public.organizer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null
    constraint organizer_profiles_display_name_len
    check (btrim(display_name) <> '' and char_length(display_name) <= 80),
  logo_url text
    constraint organizer_profiles_logo_len
    check (logo_url is null or char_length(logo_url) <= 300),
  bio text
    constraint organizer_profiles_bio_len
    check (bio is null or char_length(bio) <= 280),
  link_url text
    constraint organizer_profiles_link_len
    check (link_url is null or char_length(link_url) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. RLS
alter table public.organizer_profiles enable row level security;

-- world read: bylines render everywhere listings do (incl. anon on web later)
drop policy if exists organizer_profiles_select on public.organizer_profiles;
create policy organizer_profiles_select on public.organizer_profiles
  for select using (true);

-- writes: your own row, and only if you are actually a creator
-- (approved grant on either track, or actively leading a community)
drop policy if exists organizer_profiles_insert on public.organizer_profiles;
create policy organizer_profiles_insert on public.organizer_profiles
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      exists (select 1 from public.operator_grants g
              where g.user_id = auth.uid() and g.status = 'approved')
      or exists (select 1 from public.community_members m
                 where m.user_id = auth.uid() and m.status = 'active'
                   and m.role in ('leader', 'co_leader'))
    )
  );

drop policy if exists organizer_profiles_update on public.organizer_profiles;
create policy organizer_profiles_update on public.organizer_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists organizer_profiles_delete on public.organizer_profiles;
create policy organizer_profiles_delete on public.organizer_profiles
  for delete to authenticated
  using (user_id = auth.uid());

-- 3. updated_at rides the existing house trigger function
drop trigger if exists trg_organizer_profiles_updated_at on public.organizer_profiles;
create trigger trg_organizer_profiles_updated_at
  before update on public.organizer_profiles
  for each row execute function public.update_updated_at_column();

-- 4. privileges: anon reads, never writes; authenticated writes through RLS
revoke insert, update, delete on public.organizer_profiles from anon;
grant select on public.organizer_profiles to anon, authenticated;
grant insert, update, delete on public.organizer_profiles to authenticated;

-- 5. in-transaction self-tests (never strip these on apply)
do $selftest$
declare
  v_count int;
begin
  -- table + RLS on
  select count(*) into v_count from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'organizer_profiles' and c.relrowsecurity;
  if v_count <> 1 then
    raise exception 'selftest: organizer_profiles missing or RLS off';
  end if;

  -- exactly the four policies, one per command
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename = 'organizer_profiles';
  if v_count <> 4 then
    raise exception 'selftest: expected 4 policies, found %', v_count;
  end if;

  -- the four length constraints are live
  select count(*) into v_count from pg_constraint
  where conname in ('organizer_profiles_display_name_len',
                    'organizer_profiles_logo_len',
                    'organizer_profiles_bio_len',
                    'organizer_profiles_link_len')
    and convalidated;
  if v_count <> 4 then
    raise exception 'selftest: length constraints missing (found %)', v_count;
  end if;

  -- updated_at trigger wired to the house function
  select count(*) into v_count from pg_trigger
  where tgname = 'trg_organizer_profiles_updated_at' and not tgisinternal;
  if v_count <> 1 then
    raise exception 'selftest: updated_at trigger missing';
  end if;

  -- anon reads but never writes
  if not has_table_privilege('anon', 'public.organizer_profiles', 'select') then
    raise exception 'selftest: anon cannot select';
  end if;
  if has_table_privilege('anon', 'public.organizer_profiles', 'insert') then
    raise exception 'selftest: anon can insert';
  end if;

  raise notice 'selftest: proposal 36 structural checks green';
end;
$selftest$;

-- 6. behavioral probes (Cowork's required amendment, never strip): the
-- creator gate is exactly the kind of policy that can fail silently in
-- either direction, so prove it under simulated JWTs on fixtures that
-- already live on prod (doc 27): Sage cafe0001 = active sunset-la-club
-- MEMBER with no grant (must be refused); Marlowe cafe0002 = approved
-- event_host grant 1e3167c7 (must pass); anon must be refused outright.
-- The Marlowe probe row is deleted in-transaction.
do $probes$
declare
  v_refused boolean;
  v_count int;
begin
  -- probe 1: anon cannot insert (privilege, before RLS even matters)
  v_refused := false;
  begin
    execute 'set local role anon';
    insert into public.organizer_profiles (user_id, display_name)
    values ('cafe0002-0000-0000-0000-000000000002', 'anon probe');
  exception when others then
    v_refused := true;
  end;
  execute 'reset role';
  if not v_refused then
    raise exception 'probe: anon insert was accepted';
  end if;

  -- probe 2: a plain member with no grant is refused by the creator gate
  v_refused := false;
  perform set_config('request.jwt.claims',
    '{"sub":"cafe0001-0000-0000-0000-000000000001","role":"authenticated"}', true);
  begin
    execute 'set local role authenticated';
    insert into public.organizer_profiles (user_id, display_name)
    values ('cafe0001-0000-0000-0000-000000000001', 'sage probe');
  exception when others then
    v_refused := true;
  end;
  execute 'reset role';
  if not v_refused then
    raise exception 'probe: creator gate let a grantless member insert';
  end if;

  -- probe 3: an approved event_host grant passes, own row only
  perform set_config('request.jwt.claims',
    '{"sub":"cafe0002-0000-0000-0000-000000000002","role":"authenticated"}', true);
  execute 'set local role authenticated';
  insert into public.organizer_profiles (user_id, display_name)
  values ('cafe0002-0000-0000-0000-000000000002', 'marlowe probe');
  execute 'reset role';
  select count(*) into v_count from public.organizer_profiles
  where user_id = 'cafe0002-0000-0000-0000-000000000002';
  if v_count <> 1 then
    raise exception 'probe: creator insert did not land';
  end if;

  -- the probe row never survives the transaction
  delete from public.organizer_profiles
  where user_id = 'cafe0002-0000-0000-0000-000000000002';

  raise notice 'selftest: proposal 36 behavioral probes green';
end;
$probes$;

