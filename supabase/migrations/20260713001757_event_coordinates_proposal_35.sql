-- 35: event coordinates (doc 34 3.2). Reviewed by Cowork, applied on Liz's go
-- after a green ROLLBACK dry-run (2026-07-12, prod version 20260713001757).
-- Additive: two nullable columns + one new owner-or-leader RPC; shared
-- operator RPCs untouched. Proposal doc: Events_Communities/35.

alter table public.explore_events
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- drop-if-exists first so a re-apply is a clean no-op (Cowork-suggested)
alter table public.explore_events
  drop constraint if exists explore_events_latitude_range,
  drop constraint if exists explore_events_longitude_range;
alter table public.explore_events
  add constraint explore_events_latitude_range
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  add constraint explore_events_longitude_range
    check (longitude is null or (longitude >= -180 and longitude <= 180));

-- the RPC: owner-or-leader gated, sets or clears both coordinates together
create or replace function public.operator_set_explore_event_coords(
  p_event_id uuid,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, host_user_id, community_id into v_row
  from explore_events where id = p_event_id;
  if v_row.id is null then
    raise exception 'Event not found';
  end if;
  if not (v_row.host_user_id = v_uid
          or (v_row.community_id is not null and is_community_leader(v_row.community_id, v_uid))) then
    raise exception 'Not authorized';
  end if;
  -- both or neither: a lone latitude is never a place
  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Coordinates travel as a pair';
  end if;

  update explore_events set
    latitude = p_latitude,
    longitude = p_longitude,
    updated_at = now()
  where id = p_event_id;
end;
$function$;

-- privileges (the write-RPC pattern: never anon, never public)
revoke all on function public.operator_set_explore_event_coords(uuid, double precision, double precision) from public;
revoke all on function public.operator_set_explore_event_coords(uuid, double precision, double precision) from anon;
grant execute on function public.operator_set_explore_event_coords(uuid, double precision, double precision) to authenticated;

-- in-transaction self-tests (never stripped)
do $selftest$
declare
  v_count int;
begin
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'explore_events'
    and column_name in ('latitude', 'longitude') and is_nullable = 'YES';
  if v_count <> 2 then
    raise exception 'selftest: latitude/longitude columns missing or not nullable (found %)', v_count;
  end if;

  if not (select convalidated from pg_constraint
          where conname = 'explore_events_latitude_range') then
    raise exception 'selftest: latitude range check not validated';
  end if;
  if not (select convalidated from pg_constraint
          where conname = 'explore_events_longitude_range') then
    raise exception 'selftest: longitude range check not validated';
  end if;

  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operator_set_explore_event_coords'
    and p.prosecdef;
  if v_count <> 1 then
    raise exception 'selftest: operator_set_explore_event_coords missing or not security definer';
  end if;
  if has_function_privilege('anon',
       'public.operator_set_explore_event_coords(uuid, double precision, double precision)',
       'execute') then
    raise exception 'selftest: anon can execute operator_set_explore_event_coords';
  end if;
  if not has_function_privilege('authenticated',
       'public.operator_set_explore_event_coords(uuid, double precision, double precision)',
       'execute') then
    raise exception 'selftest: authenticated cannot execute operator_set_explore_event_coords';
  end if;

  raise notice 'selftest: proposal 35 all green';
end;
$selftest$;
