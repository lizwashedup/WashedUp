-- Measure registration against completed accounts, not raw token-row churn.
-- A quiet signup day is not an outage; a day where completed accounts cannot
-- obtain a OneSignal subscription is.
create or replace function public.push_registration_health_v2(
  p_min_completed integer default 5,
  p_min_coverage numeric default 0.50,
  p_active_floor integer default 15
)
returns table(
  completed_24h integer,
  covered_24h integer,
  coverage numeric,
  refreshed_24h integer,
  active_24h integer,
  evaluated boolean,
  healthy boolean
)
language sql
security definer
set search_path = public
as $$
  with completed as (
    select p.id
    from public.profiles p
    where p.onboarding_status::text = 'complete'
      and p.created_at > now() - interval '24 hours'
  ), signup as (
    select
      count(*)::integer as completed_24h,
      count(*) filter (where exists (
        select 1
        from public.device_tokens d
        where d.user_id = completed.id
          and nullif(trim(d.onesignal_player_id), '') is not null
      ))::integer as covered_24h
    from completed
  ), activity as (
    select count(distinct d.user_id)::integer as active_24h
    from public.device_tokens d
    where d.last_seen_at > now() - interval '24 hours'
      and nullif(trim(d.onesignal_player_id), '') is not null
  ), refreshes as (
    select count(distinct d.user_id)::integer as refreshed_24h
    from public.device_tokens d
    where d.last_seen_at > now() - interval '24 hours'
      and d.created_at <= now() - interval '24 hours'
      and nullif(trim(d.onesignal_player_id), '') is not null
  )
  select
    s.completed_24h,
    s.covered_24h,
    case when s.completed_24h > 0
      then round(s.covered_24h::numeric / s.completed_24h, 4)
      else null
    end as coverage,
    r.refreshed_24h,
    a.active_24h,
    s.completed_24h >= p_min_completed as evaluated,
    a.active_24h >= p_active_floor
      and (s.completed_24h < p_min_completed
        or s.covered_24h::numeric / nullif(s.completed_24h, 0) >= p_min_coverage)
      as healthy
  from signup s cross join activity a cross join refreshes r;
$$;

revoke all on function public.push_registration_health_v2(integer, numeric, integer) from public, anon, authenticated;
grant execute on function public.push_registration_health_v2(integer, numeric, integer) to service_role;
