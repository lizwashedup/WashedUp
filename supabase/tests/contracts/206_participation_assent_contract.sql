begin;
set local role authenticated;
set local request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
do $$
declare
  actor uuid := auth.uid(); plan uuid := gen_random_uuid(); receipt uuid; prior uuid; other uuid; stamp record;
begin
  select * into strict stamp from public.get_participation_notice_status();
  receipt := public.record_participation_assent('plan',plan,null,'Sample','join',actor,stamp.notice_version,stamp.terms_version);
  if receipt is null or receipt is distinct from public.record_participation_assent('plan',plan,null,'Sample','join',actor,stamp.notice_version,stamp.terms_version)
     or (select count(*) from public.participation_notice_assents where listing_id=plan)<>1 then
    raise exception 'Repeated affirmation did not return exactly one immutable receipt';
  end if;
  other := public.record_participation_assent('plan',plan,null,'Different creator','join',actor,stamp.notice_version,stamp.terms_version);
  if other is null or other=receipt then raise exception 'Unrelated organizer matched'; end if;
  plan := gen_random_uuid();
  prior := public.record_participation_assent('explore_event',plan,null,'Example','rsvp');
  if prior is distinct from public.record_participation_assent('explore_event',plan,null,'Example','rsvp',actor,stamp.notice_version,stamp.terms_version) then
    raise exception 'Exact legacy row was repeated';
  end if;
  begin
    perform public.record_participation_assent('plan',plan,null,'Sample','join',gen_random_uuid(),stamp.notice_version,stamp.terms_version);
    raise exception 'Wrong viewer accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_participation_assent('plan',plan,null,'Sample','join',actor,stamp.notice_version,'obsolete');
    raise exception 'Obsolete terms accepted';
  exception when invalid_parameter_value then null; end;
  if has_function_privilege('anon','public.record_participation_assent(text,uuid,uuid,text,text,uuid,text,text)','execute') then
    raise exception 'Anonymous agreement permitted';
  end if;
end $$;
rollback;
