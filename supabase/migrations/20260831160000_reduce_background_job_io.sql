-- Reduce avoidable pg_cron churn before considering a larger Supabase compute tier.
--
-- This migration deliberately leaves every money-critical and immediate-health
-- schedule unchanged. It only slows low-volume batch work whose current cadence
-- is not justified by live usage, adds the missing auth.users(created_at) index
-- used by the signup watchdog, and bounds pg_cron's run-history growth.
--
-- Production evidence captured 2026-08-31 before this was written:
--   * cron.job_run_details: 216,635 rows / 98 MB, with no retention policy.
--   * application email outbox: 22 rows ever, none pending; worker ran every 2m.
--   * album hearts: 0 rows ever; batch worker ran every 30m.
--   * waitlist: 1 row ever, none invited; expiry worker ran every 15m.
--   * auth.users(created_at) watchdog predicate used a sequential scan every 5m.
--
-- Review-only until a separate production-apply approval. Applying this file
-- changes scheduler state and briefly locks auth.users while creating one index.

begin;

do $preflight$
declare
  v_mismatches text;
begin
  -- Changed jobs may be at either the pre-migration or final schedule so the
  -- migration is safe to re-run, but any other drift fails closed.
  select string_agg(format('%s=%s', jobname, schedule), ', ' order by jobname)
    into v_mismatches
  from cron.job
  where (jobname = 'send-application-emails' and schedule not in ('*/2 * * * *', '*/10 * * * *'))
     or (jobname = 'albums-flush-upload-notifications' and schedule not in ('*/5 * * * *', '*/15 * * * *'))
     or (jobname = 'waitlist-exceptions-expire' and schedule not in ('*/15 * * * *', '11 * * * *'))
     or (jobname = 'albums-flush-heart-batches' and schedule not in ('*/30 * * * *', '23 */2 * * *'));

  if v_mismatches is not null then
    raise exception 'refusing cron IO cleanup because changed-job schedules drifted: %', v_mismatches;
  end if;

  if (select count(*) from cron.job
      where active and jobname in (
        'send-application-emails',
        'albums-flush-upload-notifications',
        'waitlist-exceptions-expire',
        'albums-flush-heart-batches'
      )) <> 4 then
    raise exception 'refusing cron IO cleanup because a changed job is missing or inactive';
  end if;

  -- These schedules are contractual guardrails. This migration must never
  -- weaken payment processing, push monitoring, or plan completion.
  if (select count(*) from cron.job where active and jobname = 'ticket-inbox-drain' and schedule = '* * * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'ticket-inbox-age-watchdog' and schedule = '*/5 * * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'ticket-payout-release' and schedule = '0 */6 * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'ticket-holds-release-expired' and schedule = '*/5 * * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'monitor-push-health' and schedule = '*/5 * * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'auto-complete-past-plans' and schedule = '0 * * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'auto-complete-past-explore-events' and schedule = '7 * * * *') <> 1 then
    raise exception 'refusing cron IO cleanup because a protected schedule is missing, inactive, or changed';
  end if;

  if exists (
    select 1 from cron.job
    where jobname = 'purge-cron-job-run-history'
      and (not active or schedule <> '43 4 * * *')
  ) then
    raise exception 'refusing cron IO cleanup because the history-retention schedule drifted';
  end if;
end
$preflight$;

-- run_signup_watchdog evaluates 60-second, 60-minute, 6-hour, and 28-day
-- windows on auth.users.created_at. Without this index all four predicates
-- repeatedly scan the complete auth.users table.
create index if not exists users_created_at_idx
  on auth.users (created_at desc);

do $reschedule$
declare
  v_jobid bigint;
begin
  select jobid into strict v_jobid from cron.job where jobname = 'send-application-emails';
  perform cron.alter_job(job_id := v_jobid, schedule := '*/10 * * * *');

  select jobid into strict v_jobid from cron.job where jobname = 'albums-flush-upload-notifications';
  perform cron.alter_job(job_id := v_jobid, schedule := '*/15 * * * *');

  select jobid into strict v_jobid from cron.job where jobname = 'waitlist-exceptions-expire';
  perform cron.alter_job(job_id := v_jobid, schedule := '11 * * * *');

  select jobid into strict v_jobid from cron.job where jobname = 'albums-flush-heart-batches';
  perform cron.alter_job(job_id := v_jobid, schedule := '23 */2 * * *');
end
$reschedule$;

create or replace function public.purge_cron_job_run_history(
  p_retention interval default interval '30 days',
  p_batch_size integer default 10000
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, cron
as $function$
declare
  v_deleted integer;
begin
  if p_retention is null or p_retention < interval '7 days' then
    raise exception 'cron history retention must be at least 7 days';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'cron history batch size must be between 1 and 10000';
  end if;

  with expired as (
    select runid
    from cron.job_run_details
    where end_time is not null
      and end_time < now() - p_retention
    order by runid
    limit p_batch_size
  )
  delete from cron.job_run_details d
  using expired
  where d.runid = expired.runid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.purge_cron_job_run_history(interval, integer)
  from public, anon, authenticated, service_role;

select cron.schedule(
  'purge-cron-job-run-history',
  '43 4 * * *',
  $$select public.purge_cron_job_run_history();$$
);

do $postflight$
begin
  if (select count(*) from cron.job where active and jobname = 'send-application-emails' and schedule = '*/10 * * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'albums-flush-upload-notifications' and schedule = '*/15 * * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'waitlist-exceptions-expire' and schedule = '11 * * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'albums-flush-heart-batches' and schedule = '23 */2 * * *') <> 1
     or (select count(*) from cron.job where active and jobname = 'purge-cron-job-run-history' and schedule = '43 4 * * *') <> 1 then
    raise exception 'cron IO cleanup postflight failed';
  end if;
end
$postflight$;

commit;
