\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create table auth.users (
  id uuid primary key,
  created_at timestamptz not null default now()
);

create schema cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null unique,
  schedule text not null,
  command text not null default 'select 1',
  active boolean not null default true
);
create table cron.job_run_details (
  runid bigint generated always as identity primary key,
  jobid bigint not null,
  start_time timestamptz,
  end_time timestamptz,
  status text
);

create function cron.alter_job(
  job_id bigint,
  schedule text default null,
  command text default null,
  database text default null,
  username text default null,
  active boolean default null
)
returns void
language plpgsql
as $function$
begin
  update cron.job j
  set schedule = coalesce(alter_job.schedule, j.schedule),
      command = coalesce(alter_job.command, j.command),
      active = coalesce(alter_job.active, j.active)
  where j.jobid = alter_job.job_id;
end;
$function$;

create function cron.schedule(job_name text, schedule text, command text)
returns bigint
language plpgsql
as $function$
declare
  v_jobid bigint;
begin
  insert into cron.job(jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update
    set schedule = excluded.schedule,
        command = excluded.command,
        active = true
  returning jobid into v_jobid;
  return v_jobid;
end;
$function$;

insert into cron.job(jobname, schedule) values
  ('send-application-emails', '*/2 * * * *'),
  ('albums-flush-upload-notifications', '*/5 * * * *'),
  ('waitlist-exceptions-expire', '*/15 * * * *'),
  ('albums-flush-heart-batches', '*/30 * * * *'),
  ('ticket-inbox-drain', '* * * * *'),
  ('ticket-inbox-age-watchdog', '*/5 * * * *'),
  ('ticket-payout-release', '0 */6 * * *'),
  ('ticket-holds-release-expired', '*/5 * * * *'),
  ('monitor-push-health', '*/5 * * * *'),
  ('auto-complete-past-plans', '0 * * * *'),
  ('auto-complete-past-explore-events', '7 * * * *');
