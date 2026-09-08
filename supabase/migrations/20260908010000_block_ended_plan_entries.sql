-- One lifecycle rule for every membership entry path. The native UI hides
-- ended plans and removes their CTA, but this database guard is the final
-- authority for stale clients, deep links, and direct RPC calls.

create or replace function public.reject_ended_plan_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
begin
  if new.status is distinct from 'joined' then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and old.status is not distinct from 'joined'
    and old.event_id is not distinct from new.event_id then
    return new;
  end if;

  select start_time, end_time, status
    into v_start, v_end, v_status
  from public.events
  where id = new.event_id;

  if lower(coalesce(v_status, '')) in ('cancelled', 'completed')
    or coalesce(v_end, v_start + interval '3 hours') <= now() then
    raise exception 'plan_ended' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_reject_ended_plan_membership on public.event_members;
create trigger trg_reject_ended_plan_membership
before insert or update of status, event_id on public.event_members
for each row execute function public.reject_ended_plan_membership();

create or replace function public.reject_ended_plan_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
begin
  select start_time, end_time, status
    into v_start, v_end, v_status
  from public.events
  where id = new.event_id;

  if lower(coalesce(v_status, '')) in ('cancelled', 'completed')
    or coalesce(v_end, v_start + interval '3 hours') <= now() then
    raise exception 'plan_ended' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_reject_ended_plan_waitlist on public.event_waitlist;
create trigger trg_reject_ended_plan_waitlist
before insert or update of event_id on public.event_waitlist
for each row execute function public.reject_ended_plan_waitlist();

revoke all on function public.reject_ended_plan_membership() from public, anon, authenticated;
revoke all on function public.reject_ended_plan_waitlist() from public, anon, authenticated;
