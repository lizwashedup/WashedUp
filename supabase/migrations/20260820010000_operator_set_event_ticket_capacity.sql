-- ============================================================================
-- operator_set_event_ticket_capacity (2026-08-20) -- DRAFT, NOT YET APPLIED
--
-- C-21: a creator's only way to set explore_events.ticket_capacity. The
-- column itself already landed in 20260817130000_explore_event_rsvp_capacity.sql
-- (confirmed live against prod 2026-08-20 via a direct schema-cache probe),
-- but that migration's own header explicitly flagged "a creator currently
-- has no way to change capacity after publish" as a real, separate gap --
-- this closes it. It does not touch set_event_rsvp_atomic (same migration),
-- which is the enforcement point at RSVP time and is untouched here.
--
-- Modeled on operator_set_explore_event_coords
-- (20260713001757_event_coordinates_proposal_35.sql: owner-or-leader gate,
-- its own dedicated RPC), deliberately NOT on the full-overwrite
-- operator_create/update_explore_event RPCs. Those two RPCs' signatures as
-- tracked in this repo are known stale -- 20260817130000's own RISK B notes
-- that lib/creatorEvents.ts already calls them with p_end_time and
-- p_description_blocks, neither of which appears in any tracked migration,
-- meaning the real prod signatures have drifted ahead of this repo's
-- history. Hand-adding a parameter to either from this checkout risks
-- silently dropping live behavior or creating an ambiguous overload
-- PostgREST can't resolve. A dedicated, self-contained RPC has no such
-- risk: it never touches either existing function.
--
-- REJECT, NOT WAITLIST: matches 20260817130000's own ruling for this exact
-- column -- once full, an RSVP is rejected outright, never queued. This RPC
-- only ever sets the number.
-- ============================================================================

begin;

create or replace function public.operator_set_event_ticket_capacity(
  p_event_id uuid,
  p_ticket_capacity integer default null
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
  if p_ticket_capacity is not null and p_ticket_capacity <= 0 then
    raise exception 'Capacity has to be at least 1, or left blank for unlimited.';
  end if;

  update explore_events set
    ticket_capacity = p_ticket_capacity,
    updated_at = now()
  where id = p_event_id;
end;
$function$;

-- privileges (the write-RPC pattern: never anon, never public)
revoke all on function public.operator_set_event_ticket_capacity(uuid, integer) from public;
revoke all on function public.operator_set_event_ticket_capacity(uuid, integer) from anon;
grant execute on function public.operator_set_event_ticket_capacity(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- in-transaction self-test (never stripped, house style). Privilege/existence
-- checks mirror proposal 35's own coords self-test; the functional block
-- below additionally proves the ownership gate, the round-trip, and the
-- floor guard, using two real existing non-admin users the same way
-- 20260817130000's own self-test does (host_user_id has a hard FK to
-- auth.users, so a fabricated UUID would fail that FK, not test anything).
-- ----------------------------------------------------------------------------
do $selftest$
declare
  v_count int;
  v_admin_role text := current_user;
  v_owner uuid;
  v_stranger uuid;
  v_event_id uuid;
  v_capacity integer;
begin
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operator_set_event_ticket_capacity'
    and p.prosecdef;
  if v_count <> 1 then
    raise exception 'selftest: operator_set_event_ticket_capacity missing or not security definer';
  end if;
  if has_function_privilege('anon',
       'public.operator_set_event_ticket_capacity(uuid, integer)',
       'execute') then
    raise exception 'selftest: anon can execute operator_set_event_ticket_capacity';
  end if;
  if not has_function_privilege('authenticated',
       'public.operator_set_event_ticket_capacity(uuid, integer)',
       'execute') then
    raise exception 'selftest: authenticated cannot execute operator_set_event_ticket_capacity';
  end if;

  select id into v_owner from auth.users u
  where not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  select id into v_stranger from auth.users u
  where u.id <> v_owner
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not public.has_role(u.id, 'admin'::app_role)
  order by created_at limit 1;
  if v_owner is null or v_stranger is null then
    raise exception 'selftest: needs two existing non-admin users';
  end if;

  insert into explore_events (title, category, status, event_date, start_time, host_user_id)
  values ('selftest ticket capacity', 'community', 'Live',
          (now() + interval '5 days')::date, now() + interval '5 days', v_owner)
  returning id into v_event_id;

  -- ---------- the owner can set it, and it round-trips ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.operator_set_event_ticket_capacity(v_event_id, 25);
  perform set_config('role', v_admin_role, true);
  select ticket_capacity into v_capacity from explore_events where id = v_event_id;
  if v_capacity <> 25 then
    raise exception 'selftest: capacity did not round-trip, got %', v_capacity;
  end if;

  -- ---------- null clears it back to unlimited ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.operator_set_event_ticket_capacity(v_event_id, null);
  perform set_config('role', v_admin_role, true);
  select ticket_capacity into v_capacity from explore_events where id = v_event_id;
  if v_capacity is not null then
    raise exception 'selftest: null capacity did not clear, got %', v_capacity;
  end if;

  -- ---------- a non-owner, non-leader stranger is rejected ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.operator_set_event_ticket_capacity(v_event_id, 10);
    raise exception 'selftest: a stranger was able to set another organizer''s capacity';
  exception
    when others then
      if sqlerrm <> 'Not authorized' then
        raise exception 'selftest: wrong rejection reason for a stranger: %', sqlerrm;
      end if;
  end;
  perform set_config('role', v_admin_role, true);

  -- ---------- zero is rejected (the "at least 1" floor) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.operator_set_event_ticket_capacity(v_event_id, 0);
    raise exception 'selftest: a capacity of 0 was accepted';
  exception
    when others then
      if sqlerrm <> 'Capacity has to be at least 1, or left blank for unlimited.' then
        raise exception 'selftest: wrong rejection reason for a zero capacity: %', sqlerrm;
      end if;
  end;
  perform set_config('role', v_admin_role, true);

  -- ---------- cleanup ----------
  delete from explore_events where id = v_event_id;

  raise notice 'selftest: operator_set_event_ticket_capacity all green';
end;
$selftest$;

commit;

notify pgrst, 'reload schema';
