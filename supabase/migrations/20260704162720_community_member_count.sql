-- ============================================================================
-- web front door seam: public member count for the lock view.
-- The /c/[handle] lock view (doc 09) shows social proof to anon visitors,
-- but community_members RLS is member-scoped, so anon cannot count. This
-- security-definer aggregate answers ONLY a count, ONLY for active
-- communities (no probing draft or archived sizes), no identities.
-- HELD: committed on feature/communities, NOT applied; rides the phase 3
-- batch. Web renders without the count until then (graceful fallback).
-- ============================================================================

begin;

create or replace function public.get_community_member_count(p_community_id uuid)
returns integer
language sql stable security definer
set search_path to 'public'
as $$
  select case
    when exists (select 1 from communities c
                 where c.id = p_community_id and c.status = 'active')
    then (select count(*)::integer from community_members m
          where m.community_id = p_community_id and m.status = 'active')
    else null
  end;
$$;

revoke all on function public.get_community_member_count(uuid) from public;
grant execute on function public.get_community_member_count(uuid) to anon, authenticated;

-- in-transaction self-test (never strip on apply)
do $$
begin
  if not has_function_privilege('anon', 'public.get_community_member_count(uuid)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon cannot execute get_community_member_count';
  end if;
  if public.get_community_member_count('00000000-0000-0000-0000-000000000000'::uuid) is not null then
    raise exception 'SELF-TEST FAIL: count leaked for a nonexistent community';
  end if;
  raise notice 'community member count self-test passed';
end;
$$;

commit;
