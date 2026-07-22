-- ============================================================================
-- communities skeleton follow-up hardening (advisor pass, 2026-07-02).
-- 1. Supabase default privileges grant EXECUTE to anon on every new function;
--    the skeleton's revoke-from-PUBLIC did not remove that explicit grant.
--    Anon gains nothing from these (create_community raises 'Not
--    authenticated', leave_community no-ops), but the write RPCs should not
--    be callable by anon at all. The three read helpers keep anon execute:
--    RLS policies evaluate them for anon queries.
-- 2. Pin search_path on the trigger function (advisor
--    function_search_path_mutable); it references no tables but pinning is
--    house hygiene.
-- ============================================================================

begin;

revoke execute on function public.create_community(text, text, text) from anon;
revoke execute on function public.leave_community(uuid) from anon;

alter function public.community_members_identity_immutable() set search_path = 'public';

-- in-transaction self-test (never strip on apply)
do $$
begin
  if has_function_privilege('anon', 'public.create_community(text, text, text)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can still execute create_community';
  end if;
  if has_function_privilege('anon', 'public.leave_community(uuid)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon can still execute leave_community';
  end if;
  if not has_function_privilege('authenticated', 'public.create_community(text, text, text)', 'execute') then
    raise exception 'SELF-TEST FAIL: authenticated lost execute on create_community';
  end if;
  if not has_function_privilege('anon', 'public.is_community_member(uuid, uuid)', 'execute') then
    raise exception 'SELF-TEST FAIL: anon lost execute on is_community_member (RLS needs it)';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'community_members_identity_immutable'
      and p.proconfig::text like '%search_path%'
  ) then
    raise exception 'SELF-TEST FAIL: trigger function search_path not pinned';
  end if;
  raise notice 'fn hardening self-test passed';
end;
$$;

commit;
