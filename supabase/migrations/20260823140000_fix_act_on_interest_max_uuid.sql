-- fix: act_on_interest() used `max(id)` to pick a "primary" signal id out of
-- the matching active event_interest_signals rows. `id` is uuid, and
-- Postgres has no built-in max(uuid) aggregate -- confirmed broken live via
-- `supabase db lint --linked` 2026-08-23: "function max(uuid) does not
-- exist". Every real call to this function (invite or skip) has always
-- errored before reaching any of its UPDATE/INSERT statements.
--
-- v_primary_signal is only used to attach one log row in
-- event_interest_actions -- which specific matching signal it points to
-- doesn't carry product meaning, so picking the most recently created one
-- is a safe, deterministic replacement for the broken max(id).

CREATE OR REPLACE FUNCTION public.act_on_interest(p_interested_user_id uuid, p_new_event_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id        uuid := auth.uid();
  v_new_creator    uuid;
  v_signal_count   integer;
  v_primary_signal uuid;
  v_event_title    text;
  v_creator_name   text;
  v_now_expired    integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_action not in ('invite','skip') then
    raise exception 'invalid action: %', p_action using errcode = 'P0001';
  end if;

  select creator_user_id, title into v_new_creator, v_event_title
  from events where id = p_new_event_id;
  if v_new_creator is null or v_new_creator <> v_user_id then
    raise exception 'you can only act on interest for your own plan' using errcode = 'P0001';
  end if;

  select count(*) into v_signal_count
  from event_interest_signals
  where creator_id = v_user_id
    and interested_user_id = p_interested_user_id
    and status = 'active';

  select id into v_primary_signal
  from event_interest_signals
  where creator_id = v_user_id
    and interested_user_id = p_interested_user_id
    and status = 'active'
  order by created_at desc
  limit 1;

  if v_signal_count = 0 then
    return;
  end if;

  if p_action = 'invite' then
    update event_interest_signals
       set status = 'consumed',
           consumed_at = now(),
           consumed_by_event_id = p_new_event_id
     where creator_id = v_user_id
       and interested_user_id = p_interested_user_id
       and status = 'active';

    insert into event_interest_actions (signal_id, action, action_event_id)
    values (v_primary_signal, 'invite', p_new_event_id);

    select first_name_display into v_creator_name from profiles where id = v_user_id;
    insert into app_notifications (user_id, type, title, body, event_id, actor_user_id)
    values (
      p_interested_user_id,
      'interest_invite',
      coalesce(v_creator_name, 'A creator') || ' has a new plan',
      coalesce(v_creator_name, 'A creator') || ' is doing something and thought of you. Check it out.',
      p_new_event_id,
      v_user_id
    );
  else
    insert into event_interest_actions (signal_id, action, action_event_id)
    select id, 'skip', p_new_event_id
    from event_interest_signals
    where creator_id = v_user_id
      and interested_user_id = p_interested_user_id
      and status = 'active';

    update event_interest_signals
       set skip_count = skip_count + 1
     where creator_id = v_user_id
       and interested_user_id = p_interested_user_id
       and status = 'active';

    update event_interest_signals
       set status = 'expired',
           expired_at = now(),
           expiry_reason = 'skip_limit'
     where creator_id = v_user_id
       and interested_user_id = p_interested_user_id
       and status = 'active'
       and skip_count >= 3;
  end if;
end;
$function$;
