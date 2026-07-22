-- ============================================================================
-- PART A of the join-flow batch (proposal doc 14, Cowork-approved 2026-07-06):
-- the 'declined' community_member_status value, its own migration because
-- Postgres cannot add an enum value and use it in one transaction (55P04),
-- and the join_flow migration's self-test writes it. Never-admitted (declined)
-- stays distinct from kicked-out (removed); rejoin-after-decline stays the
-- logged open question, now revisitable without another migration.
-- ============================================================================

alter type public.community_member_status add value if not exists 'declined';

-- catalog-only self-test (using the value here would be the 55P04 trap)
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'community_member_status' and e.enumlabel = 'declined'
  ) then
    raise exception 'SELF-TEST FAIL: declined missing from community_member_status';
  end if;
  raise notice 'declined enum self-test passed';
end;
$$;
