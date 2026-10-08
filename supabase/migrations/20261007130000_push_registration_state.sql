create table if not exists public.push_registration_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  stage text not null check (stage in (
    'identity_ready', 'permission_observed', 'provisional_requested',
    'provisional_granted', 'prompt_requested', 'registered', 'failed'
  )),
  permission_status text not null default 'unknown' check (permission_status in (
    'not_determined', 'denied', 'authorized', 'provisional', 'ephemeral', 'unknown'
  )),
  app_version text,
  build_number text,
  update_id text,
  runtime_version text,
  error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  registered_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.push_registration_state enable row level security;

drop policy if exists push_registration_state_select_own on public.push_registration_state;
create policy push_registration_state_select_own
  on public.push_registration_state for select
  using (auth.uid() = user_id);

revoke all on public.push_registration_state from public, anon, authenticated;
grant select on public.push_registration_state to authenticated;

create or replace function public.record_push_registration_state(
  p_user_id uuid,
  p_platform text,
  p_stage text,
  p_permission_status text default 'unknown',
  p_app_version text default null,
  p_build_number text default null,
  p_update_id text default null,
  p_runtime_version text default null,
  p_error_code text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_user_id is distinct from v_user_id then raise exception 'identity mismatch'; end if;
  if p_platform not in ('ios', 'android') then raise exception 'invalid platform'; end if;
  if p_stage not in (
    'identity_ready', 'permission_observed', 'provisional_requested',
    'provisional_granted', 'prompt_requested', 'registered', 'failed'
  ) then raise exception 'invalid stage'; end if;
  if p_permission_status not in (
    'not_determined', 'denied', 'authorized', 'provisional', 'ephemeral', 'unknown'
  ) then raise exception 'invalid permission status'; end if;

  insert into public.push_registration_state as state (
    user_id, platform, stage, permission_status, app_version, build_number,
    update_id, runtime_version, error_code, attempt_count, registered_at
  ) values (
    v_user_id, p_platform, p_stage, p_permission_status, p_app_version,
    p_build_number, p_update_id, p_runtime_version, left(p_error_code, 120),
    case when p_stage in ('provisional_requested', 'prompt_requested') then 1 else 0 end,
    case when p_stage = 'registered' then now() else null end
  )
  on conflict (user_id) do update set
    platform = excluded.platform,
    stage = excluded.stage,
    permission_status = case
      when excluded.permission_status = 'unknown' then state.permission_status
      else excluded.permission_status
    end,
    app_version = coalesce(excluded.app_version, state.app_version),
    build_number = coalesce(excluded.build_number, state.build_number),
    update_id = coalesce(excluded.update_id, state.update_id),
    runtime_version = coalesce(excluded.runtime_version, state.runtime_version),
    error_code = excluded.error_code,
    attempt_count = state.attempt_count + excluded.attempt_count,
    last_attempt_at = now(),
    registered_at = case when excluded.stage = 'registered' then now() else state.registered_at end,
    updated_at = now();
end;
$$;

revoke all on function public.record_push_registration_state(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.record_push_registration_state(uuid, text, text, text, text, text, text, text, text) to authenticated;

comment on table public.push_registration_state is
  'Latest native push-registration stage per account, including build and OTA provenance.';
