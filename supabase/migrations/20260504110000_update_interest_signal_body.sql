-- Refines the body string for the interest_signal app_notification (also used
-- as the push body via the existing on_app_notification_inserted trigger).
-- Title unchanged ("[Name] would go next time"); body now reads short and
-- direct so it works as a one-line push and pairs cleanly with the avatar +
-- title in the in-app inbox row.

create or replace function public.send_interest_signal(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_creator     uuid;
  v_start       timestamptz;
  v_end         timestamptz;
  v_existing    uuid;
  v_signal_id   uuid;
  v_user_name   text;
  v_event_title text;
  v_creator_name text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select creator_user_id, start_time, end_time, title
    into v_creator, v_start, v_end, v_event_title
  from events
  where id = p_event_id;

  if v_creator is null then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;

  if v_creator = v_user_id then
    raise exception 'creators can''t signal interest in their own plan' using errcode = 'P0001';
  end if;

  if _event_is_past(v_start, v_end) then
    raise exception 'this plan has already happened' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from event_members
    where event_id = p_event_id
      and user_id = v_user_id
      and status = 'joined'
  ) then
    raise exception 'you''re already going to this plan' using errcode = 'P0001';
  end if;

  if _users_blocked(v_user_id, v_creator) then
    raise exception 'this plan isn''t available to you' using errcode = 'P0001';
  end if;

  select id into v_existing
  from event_interest_signals
  where event_id = p_event_id
    and interested_user_id = v_user_id
    and status = 'active';
  if v_existing is not null then
    return v_existing;
  end if;

  insert into event_interest_signals (event_id, interested_user_id, creator_id)
  values (p_event_id, v_user_id, v_creator)
  on conflict (event_id, interested_user_id) do update
    set status = 'active',
        skip_count = 0,
        expired_at = null,
        expiry_reason = null,
        consumed_at = null,
        consumed_by_event_id = null
  returning id into v_signal_id;

  select first_name_display into v_user_name from profiles where id = v_user_id;
  select first_name_display into v_creator_name from profiles where id = v_creator;
  insert into app_notifications (user_id, type, title, body, event_id)
  values (
    v_creator,
    'interest_signal',
    coalesce(v_user_name, 'Someone') || ' would go next time',
    'They can''t make this one, but want in on the next.',
    p_event_id
  );

  return v_signal_id;
end;
$$;
