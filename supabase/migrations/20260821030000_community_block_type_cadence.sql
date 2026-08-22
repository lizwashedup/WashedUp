-- REVIEW ONLY. Forward migration. Do not apply without explicit approval.
-- C-05 remainder: the cadence block type ("what membership feels like").
-- Spec: WashedUp_Creator_Space_Complete_Inventory.md, C-05, line 149 --
-- "media -> intro -> cadence/what membership feels like -> permissioned
-- proof -> next event -> Join door preview." Plain leader-authored
-- { text }, same shape as about/founder, no new RPC (unlike proposal 41's
-- live-resolved founder face/name).

begin;

alter type public.community_block_type add value if not exists 'cadence';

-- same-transaction enum adds can't be USED in that same transaction
-- (Postgres rule), so the self-test reads pg_enum directly, mirroring
-- 20260714052620_leader_card_proposal_41.sql.
do $selftest$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typname = 'community_block_type' and e.enumlabel = 'cadence';
  if v_count <> 1 then
    raise exception 'selftest: cadence enum label missing';
  end if;

  raise notice 'selftest: cadence enum label green';
end;
$selftest$;

commit;
