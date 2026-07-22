-- 41: the leader card + the founder block type (the people-first pack's
-- server piece). Cowork-approved as written, applied 2026-07-14 on Liz's
-- go as prod migration 20260714052620 after a fresh green ROLLBACK
-- dry-run; self-tests + probes ran in the apply transaction. Proposal
-- doc: Events_Communities/41.


-- 1. the founder block type (enum-constrained, verified above)
alter type public.community_block_type add value if not exists 'founder';

-- 2. the leader card read
create or replace function public.get_community_leader_cards(
  p_community_ids uuid[]
)
returns table (
  community_id uuid,
  display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct on (m.community_id)
    m.community_id,
    p.first_name_display as display_name,
    p.profile_photo_url as avatar_url
  from community_members m
  join communities c on c.id = m.community_id and c.status = 'active'
  join profiles_public p on p.id = m.user_id
  where m.community_id = any (p_community_ids)
    and m.role = 'leader'
    and m.status = 'active'
  order by m.community_id, m.joined_at asc nulls last;
$function$;

-- 3. privileges: world-callable by design (lock view, rail, web later)
revoke all on function public.get_community_leader_cards(uuid[]) from public;
grant execute on function public.get_community_leader_cards(uuid[]) to anon, authenticated;

-- 4. in-transaction self-tests (never strip these on apply)
do $selftest$
declare
  v_count int;
begin
  -- the founder enum label exists (added-in-txn values cannot be USED here,
  -- so pg_enum is the proof, not an insert)
  select count(*) into v_count
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typname = 'community_block_type' and e.enumlabel = 'founder';
  if v_count <> 1 then
    raise exception 'selftest: founder enum label missing';
  end if;

  -- the function exists, is security definer and stable
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_community_leader_cards'
    and p.prosecdef and p.provolatile = 's';
  if v_count <> 1 then
    raise exception 'selftest: get_community_leader_cards missing or not definer/stable';
  end if;

  -- world-callable, exactly as intended
  if not has_function_privilege('anon', 'public.get_community_leader_cards(uuid[])', 'execute') then
    raise exception 'selftest: anon cannot execute the leader-card read';
  end if;
  if not has_function_privilege('authenticated', 'public.get_community_leader_cards(uuid[])', 'execute') then
    raise exception 'selftest: authenticated cannot execute the leader-card read';
  end if;

  raise notice 'selftest: proposal 41 structural checks green';
end;
$selftest$;

-- 5. behavioral probes (simulated JWTs on live fixtures, never stripped):
-- an ACTIVE community resolves its leader's card even for anon; a DRAFT
-- community resolves NOTHING even when asked directly. The draft probe
-- community is created and deleted inside this transaction.
do $probes$
declare
  v_active_id uuid;
  v_draft_id uuid := gen_random_uuid();
  v_name text;
  v_count int;
begin
  select id into v_active_id from communities where handle = 'sunset-la-club' and status = 'active';
  if v_active_id is null then
    raise exception 'probe: fixture community sunset-la-club not found active';
  end if;

  -- a throwaway DRAFT community with a leader row (probe-only, deleted below)
  insert into communities (id, handle, name, status, created_by)
  values (v_draft_id, 'probe-draft-41', 'probe draft', 'draft',
          'ae8006dc-5bca-42b8-975a-e11ad14b796f');
  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_draft_id, 'ae8006dc-5bca-42b8-975a-e11ad14b796f', 'leader', 'active', now());

  -- probe 1: ANON resolves the active community's leader card
  execute 'set local role anon';
  select display_name into v_name
  from public.get_community_leader_cards(array[v_active_id]);
  execute 'reset role';
  if v_name is null then
    raise exception 'probe: anon could not resolve the active leader card';
  end if;

  -- probe 2: the DRAFT community returns nothing, even asked directly
  execute 'set local role anon';
  select count(*) into v_count
  from public.get_community_leader_cards(array[v_draft_id]);
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'probe: a draft community leaked a leader card';
  end if;

  -- probe 3: a signed-in stranger gets the same public card, nothing more
  perform set_config('request.jwt.claims',
    '{"sub":"cafe0002-0000-0000-0000-000000000002","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into v_count
  from public.get_community_leader_cards(array[v_active_id, v_draft_id]);
  execute 'reset role';
  if v_count <> 1 then
    raise exception 'probe: expected exactly the active card for a stranger, got %', v_count;
  end if;

  -- the probe rows never survive the transaction
  delete from community_members where community_id = v_draft_id;
  delete from communities where id = v_draft_id;

  raise notice 'selftest: proposal 41 behavioral probes green';
end;
$probes$;

