-- Private review only. Edit just the conflicting active-row path of the existing
-- function; retain its actual permission checks, ownership, grants and other logic.
-- Stop on a different implementation rather than replacing it with an older copy.
begin;
do $patch$
declare
  original text := pg_get_functiondef('public.send_interest_signal(uuid)'::regprocedure);
  anchor text := $anchor$        reactivated_at = now()          -- re-raise: advance the re-show clock
  returning id into v_signal_id;$anchor$;
  replacement text := $new$        reactivated_at = now()          -- re-raise: advance the re-show clock
    where event_interest_signals.status <> 'active'
  returning id into v_signal_id;

  -- Another transaction activated this row while we waited on the unique key.
  -- Return its receipt without changing the signal or notifying the creator again.
  if v_signal_id is null then
    select id into strict v_signal_id from event_interest_signals
      where event_id=p_event_id and interested_user_id=v_user_id and status='active';
    return v_signal_id;
  end if;$new$;
begin
  if array_length(string_to_array(original,anchor),1) <> 2 then
    raise exception 'Unexpected interest recorder definition; review the schema copy';
  end if;
  execute replace(original,anchor,replacement);
end;
$patch$;
commit;
