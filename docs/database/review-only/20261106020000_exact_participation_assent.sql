-- Held for schema-copy verification and separate approval. Old clients keep the five-argument recorder.
begin;
create or replace function public.record_participation_assent(
  p_listing_type text, p_listing_id uuid, p_organizer_user_id uuid, p_organizer_name text, p_action text,
  p_expected_user_id uuid, p_notice_version text, p_terms_version text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  receipt uuid;
  stable_id uuid;
begin
  if actor is null or actor is distinct from p_expected_user_id then
    raise exception using errcode='42501', message='Account changed';
  end if;
  if not exists (select 1 from public.current_member_terms() t
      where t.notice_version=p_notice_version and t.terms_version=p_terms_version) then
    raise exception using errcode='22023', message='Reopen the current participation notice';
  end if;

  -- Reuse an existing exact affirmation, including one recorded by an older client.
  select a.id into receipt from public.participation_notice_assents a
    where a.user_id=actor and a.listing_type=p_listing_type and a.listing_id=p_listing_id
      and a.organizer_user_id is not distinct from p_organizer_user_id and a.organizer_name=p_organizer_name
      and a.action=p_action and a.notice_version=p_notice_version and a.terms_version=p_terms_version
    order by a.created_at, a.id limit 1;
  if found then return receipt; end if;

  -- JSON separates fields (including NULL) without delimiter ambiguity. A stable
  -- primary key lets PostgreSQL arbitrate concurrent retries, without updating
  -- an immutable row, adding a grant, or assuming that a negative read is final.
  stable_id := left(encode(sha256(convert_to(jsonb_build_array('participation-assent-v1',
    actor,p_listing_type,p_listing_id,p_organizer_user_id,p_organizer_name,p_action,p_notice_version,p_terms_version)::text,'UTF8')),'hex'),32)::uuid;
  insert into public.participation_notice_assents
    (id,user_id,listing_type,listing_id,organizer_user_id,organizer_name,action,notice_version,terms_version)
    values(stable_id,actor,p_listing_type,p_listing_id,p_organizer_user_id,p_organizer_name,p_action,p_notice_version,p_terms_version)
    on conflict(id) do nothing returning id into receipt;
  if found then return receipt; end if;

  select a.id into strict receipt from public.participation_notice_assents a
    where a.id=stable_id and a.user_id=actor and a.listing_type=p_listing_type and a.listing_id=p_listing_id
      and a.organizer_user_id is not distinct from p_organizer_user_id and a.organizer_name=p_organizer_name
      and a.action=p_action and a.notice_version=p_notice_version and a.terms_version=p_terms_version;
  return receipt;
end;
$$;
revoke all on function public.record_participation_assent(text,uuid,uuid,text,text,uuid,text,text) from public,anon;
grant execute on function public.record_participation_assent(text,uuid,uuid,text,text,uuid,text,text) to authenticated;
commit;
