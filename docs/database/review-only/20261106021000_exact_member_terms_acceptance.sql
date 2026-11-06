-- Private prerequisite. Keep the original no-argument recorder for older clients.
begin;
create or replace function public.record_member_terms_acceptance(p_expected_user_id uuid, p_terms_version text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  receipt uuid;
  stable_id uuid;
begin
  if actor is null or actor is distinct from p_expected_user_id then
    raise exception using errcode='42501', message='Account changed';
  end if;
  if not exists (select 1 from public.current_member_terms() t where t.terms_version=p_terms_version) then
    raise exception using errcode='22023', message='Review the updated terms before agreeing';
  end if;
  select a.id into receipt from public.member_terms_acceptances a
    where a.user_id=actor and a.terms_version=p_terms_version and a.surface='reacceptance'
    order by a.created_at, a.id limit 1;
  if found then return receipt; end if;

  -- A negative read cannot see a concurrent uncommitted write. Let the unique
  -- primary key arbitrate; this never updates an existing immutable record.
  stable_id := left(encode(sha256(convert_to(
    jsonb_build_array('member-terms-reacceptance-v1',actor,p_terms_version)::text,'UTF8')),'hex'),32)::uuid;
  insert into public.member_terms_acceptances(id,user_id,terms_version,surface)
    values(stable_id,actor,p_terms_version,'reacceptance')
    on conflict(id) do nothing returning id into receipt;
  if found then return receipt; end if;

  select a.id into strict receipt from public.member_terms_acceptances a
    where a.id=stable_id and a.user_id=actor and a.terms_version=p_terms_version and a.surface='reacceptance';
  return receipt;
end;
$$;
revoke all on function public.record_member_terms_acceptance(uuid,text) from public,anon;
grant execute on function public.record_member_terms_acceptance(uuid,text) to authenticated;
commit;
