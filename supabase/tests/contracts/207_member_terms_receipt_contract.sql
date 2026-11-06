begin;
set local request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
insert into public.member_terms_acceptances(user_id,terms_version,surface) values(auth.uid(),'3.0','signup');
set local role authenticated;
do $$
declare actor uuid := auth.uid(); first_id uuid; second_id uuid;
begin
  -- Global eligibility recognizes signup; specific reacceptance evidence stays distinct.
  if (select needs_acceptance from public.get_member_terms_status()) is distinct from false then raise exception 'Signup ignored'; end if;
  first_id := public.record_member_terms_acceptance(actor,'3.0');
  second_id := public.record_member_terms_acceptance(actor,'3.0');
  if first_id is null or first_id is distinct from second_id or not exists(
    select 1 from public.member_terms_acceptances where id=first_id and surface='reacceptance' and user_id=actor
  ) or (select count(*) from public.member_terms_acceptances where user_id=actor)<>2 then raise exception 'Wrong reacceptance receipt'; end if;
  begin perform public.record_member_terms_acceptance(gen_random_uuid(),'3.0'); raise exception 'Wrong viewer accepted';
    exception when insufficient_privilege then null; end;
  begin perform public.record_member_terms_acceptance(actor,'obsolete'); raise exception 'Obsolete terms accepted';
    exception when invalid_parameter_value then null; end;
  if has_function_privilege('anon','public.record_member_terms_acceptance(uuid,text)','execute') then raise exception 'Anonymous write allowed'; end if;
end $$;
set local request.jwt.claims='{"sub":"33333333-3333-4333-8333-333333333333"}';
do $$ declare prior uuid; begin
  if (select needs_acceptance from public.get_member_terms_status()) is distinct from true then raise exception 'Account scope lost'; end if;
  prior := public.record_member_terms_acceptance();
  if prior is distinct from public.record_member_terms_acceptance(auth.uid(),'3.0') then raise exception 'Repeated existing receipt'; end if;
end $$;
rollback;
