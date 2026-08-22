-- ============================================================================
-- add city to communities + thread it through community creation
-- (inventory C-04: city required before public discovery).
--
-- ADDITIVE ONLY. NOT applied anywhere -- written 2026-08-19, same pattern as
-- the four 2026-08-18 migrations (proposal 68, welcome message, topic
-- albums, follower broadcasts): sits in the repo until Josh applies it.
-- ============================================================================

begin;

alter table public.communities
  add column city text check (city is null or char_length(city) between 2 and 60);

comment on column public.communities.city is
  'Required before a community is discoverable in public search (inventory C-04). Nullable at the column level so existing draft/active rows are not broken by this migration; the app enforces "required before publish" at the application layer.';

-- re-create create_community with an optional p_city param, routed through
-- the existing SECURITY DEFINER RPC (not a raw client UPDATE) so setting
-- city on creation does not depend on whatever column-level GRANT
-- communities carries once the join_policy work (proposal 91) lands.
--
-- drop the live 3-arg signature first: create-or-replace only overloads it,
-- and lib/creatorMode.ts (2026-08-19) always sends p_city with no fallback,
-- so leaving both signatures live would let a stale client keep calling the
-- 3-arg version while a fresh one 400s on an ambiguous/missing overload --
-- apply this migration before shipping any client that calls create_community.
drop function if exists public.create_community(text, text, text);

create or replace function public.create_community(
  p_handle text,
  p_name text,
  p_description text default null,
  p_city text default null
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

  insert into communities (handle, name, description, city, created_by)
  values (p_handle, p_name, p_description, p_city, v_uid)
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

revoke all on function public.create_community(text, text, text, text) from public;
revoke all on function public.create_community(text, text, text, text) from anon;
grant execute on function public.create_community(text, text, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'communities' and column_name = 'city'
  ) then
    raise exception 'SELF-TEST FAIL: communities.city missing';
  end if;
end;
$$;

commit;
