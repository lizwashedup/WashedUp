-- 42: the server-side withhold — leader reads of join answers become a
-- projection; email and raw zip stay washedup-only. Applied 2026-07-14 on
-- Liz's standing go as prod migration 20260714223943 (amended probes,
-- canonical md5 b8afdc90; fresh dry-run green; probes ran in the apply
-- transaction, Marlowe probe membership deleted in-transaction). The 30a
-- v1.3 disclosure promise is now true at the API layer. Proposal doc:
-- Events_Communities/42.


-- 1. the leader select path narrows: own row + admin only
drop policy if exists community_member_answers_select on public.community_member_answers;
create policy community_member_answers_select on public.community_member_answers
  for select using (
    (user_id = (select auth.uid()))
    or is_admin((select auth.uid()))
    or has_role((select auth.uid()), 'admin'::app_role)
  );

-- 2. the operator's projection
create or replace function public.get_join_answer_cards(
  p_community_id uuid
)
returns table (
  member_id uuid,
  first_name text,
  last_name text,
  area text,
  intro_answer text,
  guidelines_accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not is_community_leader(p_community_id, auth.uid()) then
    raise exception 'Not authorized';
  end if;
  return query
  select
    a.member_id,
    a.answers->>'first_name',
    a.answers->>'last_name',
    za.area,
    a.answers->>'intro_answer',
    (a.answers->>'guidelines_accepted_at')::timestamptz
  from community_member_answers a
  left join zip_areas za on za.zip = a.answers->>'zip'
  where a.community_id = p_community_id;
end;
$function$;

-- 3. privileges: leaders call it signed in; never anon, never public
revoke all on function public.get_join_answer_cards(uuid) from public;
revoke all on function public.get_join_answer_cards(uuid) from anon;
grant execute on function public.get_join_answer_cards(uuid) to authenticated;

-- 4. in-transaction self-tests (never strip these on apply)
do $selftest$
declare
  v_expr text;
  v_count int;
begin
  -- the narrowed policy exists and the leader disjunct is GONE
  select pg_get_expr(polqual, polrelid) into v_expr
  from pg_policy where polname = 'community_member_answers_select'
    and polrelid = 'public.community_member_answers'::regclass;
  if v_expr is null then
    raise exception 'selftest: select policy missing';
  end if;
  if v_expr ilike '%is_community_leader%' then
    raise exception 'selftest: the leader disjunct survived the narrowing';
  end if;
  if v_expr not ilike '%is_admin%' then
    raise exception 'selftest: the admin path fell off the policy';
  end if;

  -- the projection exists, definer, and its output shape carries no
  -- email/zip columns
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_join_answer_cards' and p.prosecdef;
  if v_count <> 1 then
    raise exception 'selftest: get_join_answer_cards missing or not definer';
  end if;
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_join_answer_cards'
    and (pg_get_function_result(p.oid) ilike '%email%'
      or pg_get_function_result(p.oid) ilike '%zip%');
  if v_count <> 0 then
    raise exception 'selftest: the projection shape leaks email or zip';
  end if;

  -- anon can never touch it
  if has_function_privilege('anon', 'public.get_join_answer_cards(uuid)', 'execute') then
    raise exception 'selftest: anon can execute the projection';
  end if;

  raise notice 'selftest: proposal 42 structural checks green';
end;
$selftest$;

-- 5. behavioral probes (simulated JWTs on the live fixtures, never
-- stripped). AMENDED after the convergence dry-run caught the original
-- probe 1 asserting the wrong thing: Liz is an ADMIN, so the policy's
-- deliberate is_admin disjunct keeps her raw read and "the leader reads
-- zero rows" is false FOR HER — the gate worked, the design stood, the
-- probe was wrong. The withhold must be proven on a NON-ADMIN operator:
-- Marlowe cafe0002 (non-member fixture, no admin role) is seated as
-- co_leader of sunset-la-club in-transaction (the 36 probe pattern) and
-- deleted before commit. Liz's read stays as the second positive probe,
-- now asserting BOTH halves of her deliberate path: the projection works
-- for her AND the raw row remains readable to an admin.
do $probes$
declare
  v_community uuid;
  v_count int;
  v_area text;
  v_refused boolean;
begin
  select id into v_community from communities where handle = 'sunset-la-club';
  if v_community is null then
    raise exception 'probe: fixture community missing';
  end if;

  -- seat the non-admin co-runner (probe-only, deleted below)
  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_community, 'cafe0002-0000-0000-0000-000000000002', 'co_leader', 'active', now());

  -- probe 1: a NON-ADMIN operator reads ZERO raw answers rows...
  perform set_config('request.jwt.claims',
    '{"sub":"cafe0002-0000-0000-0000-000000000002","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.community_member_answers
  where community_id = v_community;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'probe: a non-admin operator still reads % raw answers rows', v_count;
  end if;

  -- ...and the SAME operator reads the projection, area derived
  perform set_config('request.jwt.claims',
    '{"sub":"cafe0002-0000-0000-0000-000000000002","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*), max(c.area) into v_count, v_area
  from public.get_join_answer_cards(v_community) c;
  execute 'reset role';
  if v_count < 1 then
    raise exception 'probe: the non-admin operator projection returned nothing';
  end if;
  if v_area is null then
    raise exception 'probe: the projection did not derive the area';
  end if;

  -- probe 2: the ADMIN-leader's deliberate path, both halves documented
  -- here rather than discovered later: the projection serves her cards,
  -- AND the raw row remains readable through the policy's admin disjunct
  perform set_config('request.jwt.claims',
    '{"sub":"ae8006dc-5bca-42b8-975a-e11ad14b796f","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*), max(c.area) into v_count, v_area
  from public.get_join_answer_cards(v_community) c;
  if v_count < 1 then
    execute 'reset role';
    raise exception 'probe: the admin-leader projection returned nothing';
  end if;
  select count(*) into v_count from public.community_member_answers
  where community_id = v_community;
  execute 'reset role';
  if v_count < 1 then
    raise exception 'probe: the admin raw read fell off (the is_admin disjunct is deliberate)';
  end if;

  -- probe 3: the member still reads their OWN raw row
  perform set_config('request.jwt.claims',
    '{"sub":"cafe0001-0000-0000-0000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.community_member_answers
  where user_id = 'cafe0001-0000-0000-0000-000000000001';
  execute 'reset role';
  if v_count < 1 then
    raise exception 'probe: the member lost their own-row read';
  end if;

  -- probe 4: a plain member (not leader or co_leader) is refused the
  -- projection outright
  v_refused := false;
  perform set_config('request.jwt.claims',
    '{"sub":"cafe0001-0000-0000-0000-000000000001","role":"authenticated"}', true);
  begin
    execute 'set local role authenticated';
    select count(*) into v_count from public.get_join_answer_cards(v_community);
  exception when others then
    v_refused := true;
  end;
  execute 'reset role';
  if not v_refused then
    raise exception 'probe: a plain member reached the projection';
  end if;

  -- the probe membership never survives the transaction
  delete from community_members
  where community_id = v_community
    and user_id = 'cafe0002-0000-0000-0000-000000000002';

  raise notice 'selftest: proposal 42 behavioral probes green';
end;
$probes$;

