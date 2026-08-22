-- ============================================================================
-- add a real "purpose" field to communities + tighten name length to spec
-- (inventory C-04: no purpose field exists anywhere; name validation is
-- coded 2-80, spec wants 2-60). Confirmed live 2026-08-20: zero existing
-- communities.name rows exceed 60 characters, so tightening the constraint
-- is safe against current data.
--
-- ADDITIVE + one tightened constraint. Same create_community re-create
-- pattern as 20260819000000_community_city.sql (also 2026-08-20, already
-- applied): drop the live signature first so a stale client can never call
-- an ambiguous overload -- apply this before shipping any client that sends
-- p_purpose.
-- ============================================================================

begin;

alter table public.communities
  add column purpose text check (purpose is null or char_length(purpose) between 10 and 140);

comment on column public.communities.purpose is
  'A short, specific pitch for what this community is for (inventory C-04) -- distinct from the longer freeform description. Nullable at the column level so existing rows are not broken; the app enforces "required before publish" at the application layer, same pattern as city.';

alter table public.communities
  drop constraint if exists communities_name_check;
alter table public.communities
  add constraint communities_name_check check (char_length(name) between 2 and 60);

drop function if exists public.create_community(text, text, text, text);

create or replace function public.create_community(
  p_handle text,
  p_name text,
  p_description text default null,
  p_city text default null,
  p_purpose text default null
)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_operator_grant(v_uid, 'community_leader') then
    raise exception 'Community Leader grant required';
  end if;

  insert into communities (handle, name, description, city, purpose, created_by)
  values (p_handle, p_name, p_description, p_city, p_purpose, v_uid)
  returning id into v_id;

  insert into community_members (community_id, user_id, role, status, joined_at)
  values (v_id, v_uid, 'leader', 'active', now());

  insert into community_blocks (community_id, block_type, position) values
    (v_id, 'cover', 0),
    (v_id, 'header', 1),
    (v_id, 'about', 2),
    (v_id, 'events_auto', 3),
    (v_id, 'members_auto', 4);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- real functional self-test: create as a real approved leader, verify the
-- new purpose bound and the tightened name bound are actually enforced by
-- the live function (not just present as column comments), then clean up.
-- ---------------------------------------------------------------------------
do $$
declare
  v_leader uuid;
  v_cid uuid;
  v_raised boolean;
begin
  select user_id into v_leader from public.operator_grants
    where track = 'community_leader' and status = 'approved' limit 1;
  if v_leader is null then
    raise exception 'SELF-TEST FAIL: needs an existing approved community_leader grant to test with';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- a 1-char name is still rejected (spec min 2, unchanged)
  v_raised := false;
  begin
    perform public.create_community('selftest-c04-short-' || substr(v_leader::text, 1, 8), 'a', null, null,
      'a real purpose sentence here');
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a 1-char name was accepted';
  end if;

  -- a 61-char name is rejected after tightening from 80 to 60
  v_raised := false;
  begin
    perform public.create_community('selftest-c04-long-' || substr(v_leader::text, 1, 8), repeat('x', 61), null, null, null);
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a 61-char name was accepted after the 60-char tightening';
  end if;

  -- a 5-char purpose is rejected (spec min 10)
  v_raised := false;
  begin
    perform public.create_community('selftest-c04-shortpurpose-' || substr(v_leader::text, 1, 8),
      'selftest c04 name', null, null, 'short');
  exception when others then v_raised := true;
  end;
  if not v_raised then
    raise exception 'SELF-TEST FAIL: a 5-char purpose was accepted';
  end if;

  -- a real, valid create with a real purpose actually persists it
  v_cid := public.create_community('selftest-c04-ok-' || substr(v_leader::text, 1, 8),
    'selftest c04 community', null, null, 'a real purpose sentence for this community');
  if not exists (
    select 1 from public.communities
    where id = v_cid and purpose = 'a real purpose sentence for this community'
      and char_length(name) <= 60
  ) then
    raise exception 'SELF-TEST FAIL: valid create did not persist purpose/name correctly';
  end if;

  -- cleanup runs after reset role: community_members' RLS silently no-ops a
  -- plain leader-impersonated DELETE (0 rows affected, no error) -- caught
  -- live 2026-08-20 by a direct post-apply row count, not by this self-test
  -- itself, which is exactly why cleanup must run at full privilege, not
  -- under the same impersonated role the create happened as.
  reset role;
  delete from public.community_blocks where community_id = v_cid;
  delete from public.community_members where community_id = v_cid;
  delete from public.communities where id = v_cid;

  raise notice 'C-04 self-test passed: purpose field + tightened name bounds both enforced live';
end;
$$;

commit;
