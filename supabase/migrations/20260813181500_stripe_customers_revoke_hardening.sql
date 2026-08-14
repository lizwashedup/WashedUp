-- Security review (2026-08-13) on the prior migration caught this repo's own
-- convention was skipped: RLS-with-zero-policies alone leaves default grants
-- to anon/authenticated in place, one accidental permissive policy away from
-- exposing the full user_id -> stripe_customer_id map. Matches the pattern
-- in 20260707200000_intro_blurb.sql and
-- 20260716233736_participation_notice_evidence_proposal_49.sql.

revoke all on table public.stripe_customers from public, anon, authenticated;

do $$
declare
  v_bad_grants int;
begin
  select count(*) into v_bad_grants
  from information_schema.role_table_grants
  where table_name = 'stripe_customers'
    and grantee in ('anon','authenticated');
  if v_bad_grants <> 0 then
    raise exception 'self-test failed: % grants remain to anon/authenticated on stripe_customers', v_bad_grants;
  end if;
end $$;
