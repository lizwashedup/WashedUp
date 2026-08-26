-- ============================================================================
-- Follow-up to 20260826010000: real testing of washedup_monitor_ro against
-- cron.job just now showed 0 rows even with SELECT granted. Root cause,
-- confirmed live: cron.job and cron.job_run_details both carry an RLS policy
-- (qual: username = CURRENT_USER, role public) and every job is owned by
-- 'postgres' -- so any non-owner role, including this one, is correctly
-- filtered down to zero rows by Postgres itself. Membership in role
-- 'postgres' would fix it but hands over far more than "read cron health."
--
-- Same fix shape as the vault hash function: a SECURITY DEFINER function
-- (runs as its owner, so RLS's owner-bypass applies) exposing exactly the
-- columns cron-watchdog.sh needs and nothing else. Deliberately excludes
-- cron.job.command (the raw SQL each job runs) -- the only code path that
-- needs it is the Tier A allowlisted-rerun, which only ever runs in
-- Mac-linked mode (the allowlist starts empty), so the server-side role has
-- no need to see job bodies at all.
-- ============================================================================

create or replace function public.get_cron_health(hours_back int default 24)
returns table(
  jobid bigint,
  jobname text,
  schedule text,
  active boolean,
  recent_fail_count bigint,
  last_error text,
  last_start text,
  had_any_run_in_window boolean
)
language sql
security definer
set search_path to 'public'
as $$
  select
    j.jobid, j.jobname, j.schedule, j.active,
    coalesce(f.fails, 0) as recent_fail_count,
    f.last_error, f.last_start,
    exists(
      select 1 from cron.job_run_details d
      where d.jobid = j.jobid
        and d.start_time > now() - (hours_back || ' hours')::interval
    ) as had_any_run_in_window
  from cron.job j
  left join (
    select jobid, count(*) as fails,
           max(return_message) as last_error,
           max(start_time)::text as last_start
    from cron.job_run_details
    where start_time > now() - (hours_back || ' hours')::interval
      and status = 'failed'
    group by jobid
  ) f on f.jobid = j.jobid;
$$;

revoke all on function public.get_cron_health(int) from public;
grant execute on function public.get_cron_health(int) to washedup_monitor_ro;
