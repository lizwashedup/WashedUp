begin;

-- ─── section 1: participation-notice assents ─────────────────────────────

create table public.participation_notice_assents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  listing_type text not null constraint participation_assents_listing_type
    check (listing_type in ('plan', 'explore_event')),
  listing_id uuid not null,
  organizer_user_id uuid,
  organizer_name text not null constraint participation_assents_org_name_len
    check (char_length(organizer_name) between 1 and 200),
  action text not null constraint participation_assents_action
    check (action in ('join', 'rsvp')),
  notice_version text not null constraint participation_assents_notice_ver_len
    check (char_length(notice_version) between 1 and 40),
  terms_version text not null constraint participation_assents_terms_ver_len
    check (char_length(terms_version) between 1 and 40),
  assented_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.participation_notice_assents is
  'Append-only evidence: the Independent Activity Notice (51-legal-v4 doc 13) shown and affirmed before the user''s first join/RSVP under each material terms version. Written only by record_participation_assent(); never updated or deleted (proposal 49).';

create index participation_assents_user_terms_idx
  on public.participation_notice_assents (user_id, terms_version);

revoke all on table public.participation_notice_assents from public;
revoke all on table public.participation_notice_assents from anon;
revoke all on table public.participation_notice_assents from authenticated;
grant select on table public.participation_notice_assents to authenticated;

alter table public.participation_notice_assents enable row level security;

-- own-row read, admin read-all; NO insert/update/delete policy exists on
-- purpose — with RLS on, authenticated cannot write at all; only the definer
-- RPC (owned by postgres, bypasses RLS) writes.
create policy participation_assents_select on public.participation_notice_assents
  for select using (
    (user_id = (select auth.uid()))
    or is_admin((select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );

-- ─── section 2: ToS reacceptance evidence (the interstitial's row) ───────

create table public.member_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  terms_version text not null constraint member_terms_version_len
    check (char_length(terms_version) between 1 and 40),
  surface text not null default 'reacceptance'
    constraint member_terms_surface check (surface in ('reacceptance', 'signup')),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.member_terms_acceptances is
  'Append-only evidence: affirmative (re)acceptance of the member Terms of Service (a material revision requires reacceptance, never continued-use — legal v4.0). Written only by record_member_terms_acceptance() (proposal 49).';

create index member_terms_user_version_idx
  on public.member_terms_acceptances (user_id, terms_version);

revoke all on table public.member_terms_acceptances from public;
revoke all on table public.member_terms_acceptances from anon;
revoke all on table public.member_terms_acceptances from authenticated;
grant select on table public.member_terms_acceptances to authenticated;

alter table public.member_terms_acceptances enable row level security;

create policy member_terms_acceptances_select on public.member_terms_acceptances
  for select using (
    (user_id = (select auth.uid()))
    or is_admin((select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );

-- ─── section 3: the version source of truth (internal, one place) ────────

-- SERVER-AUTHORITATIVE versions: ToS v3.0 (51-legal-v4/01) + Participation
-- Notice v1.0 (51-legal-v4/13). A bump is a one-line migration through
-- Cowork's review, and recorder + status reads move together because they
-- all call this. No client grant: internal to the definer functions.
create or replace function public.current_member_terms()
returns table (notice_version text, terms_version text)
language sql
immutable
as $function$
  select '1.0'::text as notice_version, '3.0'::text as terms_version;
$function$;

comment on function public.current_member_terms() is
  'The material member-terms versions currently in force (proposal 49). Internal: no anon/authenticated execute; the evidence RPCs call it as owner. Bump by migration only.';

revoke all on function public.current_member_terms() from public;
revoke all on function public.current_member_terms() from anon;
revoke all on function public.current_member_terms() from authenticated;

-- ─── section 4: the recorders (definer RPCs, the only doors) ─────────────

create or replace function public.record_participation_assent(
  p_listing_type text,
  p_listing_id uuid,
  p_organizer_user_id uuid,
  p_organizer_name text,
  p_action text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_notice text;
  v_terms text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select t.notice_version, t.terms_version into v_notice, v_terms
  from public.current_member_terms() t;
  insert into public.participation_notice_assents
    (user_id, listing_type, listing_id, organizer_user_id, organizer_name,
     action, notice_version, terms_version)
  values
    (v_uid, p_listing_type, p_listing_id, p_organizer_user_id,
     p_organizer_name, p_action, v_notice, v_terms)
  returning id into v_id;
  return v_id;
end;
$function$;

comment on function public.record_participation_assent(text, uuid, uuid, text, text) is
  'Writes one immutable participation-notice assent row for the CALLER. Identity, versions, and timestamp are server-side; the client supplies only the rendered context (proposal 49).';

create or replace function public.record_member_terms_acceptance()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_terms text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select t.terms_version into v_terms from public.current_member_terms() t;
  insert into public.member_terms_acceptances (user_id, terms_version, surface)
  values (v_uid, v_terms, 'reacceptance')
  returning id into v_id;
  return v_id;
end;
$function$;

comment on function public.record_member_terms_acceptance() is
  'Writes one immutable member-ToS reacceptance row for the CALLER at the version currently in force (proposal 49).';

-- ─── section 5: the status reads (client stays version-dumb) ─────────────

create or replace function public.get_participation_notice_status()
returns table (needs_assent boolean, notice_version text, terms_version text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    (auth.uid() is not null) and not exists (
      select 1 from public.participation_notice_assents a
      where a.user_id = (select auth.uid())
        and a.terms_version = t.terms_version
    ) as needs_assent,
    t.notice_version,
    t.terms_version
  from public.current_member_terms() t;
$function$;

comment on function public.get_participation_notice_status() is
  'Does the CALLER need the Independent Activity Notice before their next join/RSVP? True until an assent row exists for the terms version in force (proposal 49).';

create or replace function public.get_member_terms_status()
returns table (needs_acceptance boolean, terms_version text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    (auth.uid() is not null) and not exists (
      select 1 from public.member_terms_acceptances m
      where m.user_id = (select auth.uid())
        and m.terms_version = t.terms_version
    ) as needs_acceptance,
    t.terms_version
  from public.current_member_terms() t;
$function$;

comment on function public.get_member_terms_status() is
  'Does the CALLER owe an affirmative (re)acceptance of the member ToS version in force? Drives the reacceptance interstitial (proposal 49).';

-- privileges: the batch-20 house pattern — revoke PUBLIC and anon explicitly
-- (Supabase default privileges grant anon EXECUTE on new fns; revoking from
-- PUBLIC alone does not remove it), grant authenticated on the four client
-- doors only.
revoke all on function public.record_participation_assent(text, uuid, uuid, text, text) from public;
revoke all on function public.record_participation_assent(text, uuid, uuid, text, text) from anon;
grant execute on function public.record_participation_assent(text, uuid, uuid, text, text) to authenticated;

revoke all on function public.record_member_terms_acceptance() from public;
revoke all on function public.record_member_terms_acceptance() from anon;
grant execute on function public.record_member_terms_acceptance() to authenticated;

revoke all on function public.get_participation_notice_status() from public;
revoke all on function public.get_participation_notice_status() from anon;
grant execute on function public.get_participation_notice_status() to authenticated;

revoke all on function public.get_member_terms_status() from public;
revoke all on function public.get_member_terms_status() from anon;
grant execute on function public.get_member_terms_status() to authenticated;

-- ─── section 6: in-transaction structural self-tests (never strip) ───────

do $selftest$
declare
  v_count int;
  v_rls boolean;
  r record;
begin
  -- RLS on, exactly one SELECT-only policy, no authenticated write grant —
  -- asserted for BOTH evidence tables
  for r in
    select unnest(array['participation_notice_assents', 'member_terms_acceptances']) as tbl
  loop
    select relrowsecurity into v_rls from pg_class
    where oid = format('public.%I', r.tbl)::regclass;
    if not v_rls then
      raise exception 'selftest: RLS not enabled on %', r.tbl;
    end if;

    select count(*) into v_count from pg_policy
    where polrelid = format('public.%I', r.tbl)::regclass;
    if v_count <> 1 then
      raise exception 'selftest: expected exactly 1 policy on %, found %', r.tbl, v_count;
    end if;
    select count(*) into v_count from pg_policy
    where polrelid = format('public.%I', r.tbl)::regclass and polcmd <> 'r';
    if v_count <> 0 then
      raise exception 'selftest: a non-SELECT policy exists on %; evidence must be immutable', r.tbl;
    end if;

    if not has_table_privilege('authenticated', format('public.%I', r.tbl), 'select') then
      raise exception 'selftest: authenticated cannot select own evidence on %', r.tbl;
    end if;
    if has_table_privilege('authenticated', format('public.%I', r.tbl), 'insert')
       or has_table_privilege('authenticated', format('public.%I', r.tbl), 'update')
       or has_table_privilege('authenticated', format('public.%I', r.tbl), 'delete') then
      raise exception 'selftest: authenticated holds a write grant on %', r.tbl;
    end if;
    if has_table_privilege('anon', format('public.%I', r.tbl), 'select') then
      raise exception 'selftest: anon can read %', r.tbl;
    end if;
  end loop;

  -- the four client doors: definer, authenticated-executable, anon-refused
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('record_participation_assent', 'record_member_terms_acceptance',
                      'get_participation_notice_status', 'get_member_terms_status');
  if v_count <> 4 then
    raise exception 'selftest: expected 4 definer functions, found %', v_count;
  end if;

  if not has_function_privilege('authenticated',
      'public.record_participation_assent(text, uuid, uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.record_member_terms_acceptance()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_participation_notice_status()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_member_terms_status()', 'execute') then
    raise exception 'selftest: authenticated lost execute on a client door';
  end if;
  if has_function_privilege('anon',
      'public.record_participation_assent(text, uuid, uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.record_member_terms_acceptance()', 'execute')
     or has_function_privilege('anon', 'public.get_participation_notice_status()', 'execute')
     or has_function_privilege('anon', 'public.get_member_terms_status()', 'execute') then
    raise exception 'selftest: anon can execute an evidence function';
  end if;

  -- the version helper is INTERNAL: neither anon nor authenticated executes it
  if has_function_privilege('anon', 'public.current_member_terms()', 'execute')
     or has_function_privilege('authenticated', 'public.current_member_terms()', 'execute') then
    raise exception 'selftest: current_member_terms is client-callable; it must be internal';
  end if;

  raise notice 'selftest: proposal 49 structural checks green';
end;
$selftest$;

-- ─── section 7: behavioral probes (simulated JWTs on live fixtures; probe
-- writes CLEANED UP before commit — the 47 amendment, zero residue) ────────

do $probes$
declare
  v_sage uuid := 'cafe0001-0000-0000-0000-000000000001';
  v_marlowe uuid := 'cafe0002-0000-0000-0000-000000000002';
  v_listing uuid := gen_random_uuid();  -- polymorphic, no FK: any uuid probes the shape
  v_count int;
  v_needs boolean;
  v_ver text;
  v_refused boolean;
  v_id uuid;
begin
  -- probe 1: a direct client INSERT into either evidence table is REFUSED
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_sage), true);
  execute 'set local role authenticated';
  v_refused := false;
  begin
    insert into public.participation_notice_assents
      (user_id, listing_type, listing_id, organizer_name, action, notice_version, terms_version)
    values (v_sage, 'plan', v_listing, 'forged', 'join', 'x', 'x');
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    execute 'reset role';
    raise exception 'probe: a user forged a participation assent directly';
  end if;
  v_refused := false;
  begin
    insert into public.member_terms_acceptances (user_id, terms_version)
    values (v_sage, 'forged');
  exception when others then
    v_refused := true;
  end;
  execute 'reset role';
  if not v_refused then
    raise exception 'probe: a user forged a terms acceptance directly';
  end if;

  -- probe 2: fresh caller NEEDS both — then recording flips both to false,
  -- with the server versions and the caller's identity (nothing client-supplied)
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_sage), true);
  execute 'set local role authenticated';
  select needs_assent into v_needs from public.get_participation_notice_status();
  if not v_needs then
    execute 'reset role';
    raise exception 'probe: fresh caller did not need the participation notice';
  end if;
  select needs_acceptance into v_needs from public.get_member_terms_status();
  if not v_needs then
    execute 'reset role';
    raise exception 'probe: fresh caller did not need the terms reacceptance';
  end if;

  v_id := public.record_participation_assent('plan', v_listing, v_marlowe, 'marlowe rivera', 'join');
  perform public.record_member_terms_acceptance();

  select needs_assent into v_needs from public.get_participation_notice_status();
  if v_needs then
    execute 'reset role';
    raise exception 'probe: participation status did not flip after assent';
  end if;
  select needs_acceptance into v_needs from public.get_member_terms_status();
  if v_needs then
    execute 'reset role';
    raise exception 'probe: terms status did not flip after acceptance';
  end if;
  execute 'reset role';

  select count(*), max(terms_version) into v_count, v_ver
  from public.participation_notice_assents where user_id = v_sage;
  if v_count <> 1 or v_ver <> '3.0' then
    raise exception 'probe: assent row wrong (count %, version %)', v_count, v_ver;
  end if;
  perform 1 from public.participation_notice_assents
  where id = v_id and user_id = v_sage and notice_version = '1.0'
    and listing_type = 'plan' and listing_id = v_listing
    and organizer_user_id = v_marlowe and organizer_name = 'marlowe rivera'
    and action = 'join';
  if not found then
    raise exception 'probe: assent row context/versions do not match what was recorded';
  end if;
  select count(*), max(terms_version) into v_count, v_ver
  from public.member_terms_acceptances where user_id = v_sage;
  if v_count <> 1 or v_ver <> '3.0' then
    raise exception 'probe: reacceptance row wrong (count %, version %)', v_count, v_ver;
  end if;

  -- probe 3: anon cannot call the recorder
  execute 'set local role anon';
  v_refused := false;
  begin
    perform public.record_participation_assent('plan', v_listing, null, 'nobody', 'join');
  exception when others then
    v_refused := true;
  end;
  execute 'reset role';
  if not v_refused then
    raise exception 'probe: anon recorded a participation assent';
  end if;

  -- probe 4: own-row read only. Plant a Marlowe row (as owner), Sage must not see it.
  insert into public.participation_notice_assents
    (user_id, listing_type, listing_id, organizer_name, action, notice_version, terms_version)
  values (v_marlowe, 'explore_event', v_listing, 'someone', 'rsvp', '1.0', '3.0');
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_sage), true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.participation_notice_assents;
  execute 'reset role';
  if v_count <> 1 then
    raise exception 'probe: Sage sees % assent rows, expected only her own 1', v_count;
  end if;

  -- probe 5: immutability — Sage can neither UPDATE nor DELETE her evidence
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_sage), true);
  execute 'set local role authenticated';
  v_refused := false;
  begin
    update public.participation_notice_assents set terms_version = 'tamper' where user_id = v_sage;
    if not found then v_refused := true; end if;  -- no write policy = 0 rows = immutable
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    execute 'reset role';
    raise exception 'probe: a user updated their own assent';
  end if;
  v_refused := false;
  begin
    delete from public.member_terms_acceptances where user_id = v_sage;
    if not found then v_refused := true; end if;
  exception when others then
    v_refused := true;
  end;
  execute 'reset role';
  if not v_refused then
    raise exception 'probe: a user deleted their own acceptance';
  end if;

  -- probe 6: the recorder refuses garbage context (CHECKs hold through the RPC)
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', v_sage), true);
  execute 'set local role authenticated';
  v_refused := false;
  begin
    perform public.record_participation_assent('community', v_listing, null, 'x', 'join');
  exception when others then
    v_refused := true;
  end;
  execute 'reset role';
  if not v_refused then
    raise exception 'probe: an out-of-scope listing_type was accepted';
  end if;

  -- CLEANUP (required, the 47 lesson): the probes wrote REAL rows; ROLLBACK
  -- hides that on a dry-run but the real APPLY commits. Remove every probe
  -- artifact and assert zero residue. Runs as the migration role (owner,
  -- bypasses RLS). Only probe rows are keyed — nothing else exists for the
  -- cafe fixtures in these brand-new tables, and the assert proves it.
  delete from public.participation_notice_assents where user_id in (v_sage, v_marlowe);
  delete from public.member_terms_acceptances where user_id in (v_sage, v_marlowe);
  select (select count(*) from public.participation_notice_assents)
       + (select count(*) from public.member_terms_acceptances) into v_count;
  if v_count <> 0 then
    raise exception 'cleanup: % evidence rows survived the probes', v_count;
  end if;

  raise notice 'selftest: proposal 49 behavioral probes green (probe residue cleaned)';
end;
$probes$;

commit;
