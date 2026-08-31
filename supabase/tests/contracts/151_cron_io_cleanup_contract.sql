\set ON_ERROR_STOP on

do $contract$
begin
  if (select count(*) from cron.job where jobname = 'send-application-emails' and schedule = '*/10 * * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'albums-flush-upload-notifications' and schedule = '*/15 * * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'waitlist-exceptions-expire' and schedule = '11 * * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'albums-flush-heart-batches' and schedule = '23 */2 * * *' and active) <> 1 then
    raise exception 'contract failed: a noncritical schedule was not reduced exactly';
  end if;

  if (select count(*) from cron.job where jobname = 'ticket-inbox-drain' and schedule = '* * * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'ticket-inbox-age-watchdog' and schedule = '*/5 * * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'ticket-payout-release' and schedule = '0 */6 * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'ticket-holds-release-expired' and schedule = '*/5 * * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'monitor-push-health' and schedule = '*/5 * * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'auto-complete-past-plans' and schedule = '0 * * * *' and active) <> 1
     or (select count(*) from cron.job where jobname = 'auto-complete-past-explore-events' and schedule = '7 * * * *' and active) <> 1 then
    raise exception 'contract failed: a protected schedule changed';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'auth'
      and tablename = 'users'
      and indexname = 'users_created_at_idx'
  ) then
    raise exception 'contract failed: signup watchdog index is missing';
  end if;

  if (select count(*) from cron.job where jobname = 'purge-cron-job-run-history' and schedule = '43 4 * * *' and active) <> 1 then
    raise exception 'contract failed: bounded cron-history retention is not scheduled';
  end if;

  if has_function_privilege('anon', 'public.purge_cron_job_run_history(interval, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purge_cron_job_run_history(interval, integer)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.purge_cron_job_run_history(interval, integer)', 'EXECUTE') then
    raise exception 'contract failed: cron-history retention is callable by an application role';
  end if;
end
$contract$;

insert into cron.job_run_details(jobid, start_time, end_time, status) values
  (1, now() - interval '90 days', now() - interval '90 days', 'succeeded'),
  (1, now() - interval '60 days', now() - interval '60 days', 'succeeded'),
  (1, now() - interval '45 days', now() - interval '45 days', 'failed'),
  (1, now() - interval '5 days', now() - interval '5 days', 'succeeded'),
  (1, now(), null, 'running');

do $retention$
declare
  v_deleted integer;
begin
  select public.purge_cron_job_run_history(interval '30 days', 2) into v_deleted;
  if v_deleted <> 2 then
    raise exception 'contract failed: bounded retention deleted %, expected 2', v_deleted;
  end if;
  if (select count(*) from cron.job_run_details where end_time < now() - interval '30 days') <> 1 then
    raise exception 'contract failed: bounded retention did not leave exactly one old row';
  end if;

  select public.purge_cron_job_run_history() into v_deleted;
  if v_deleted <> 1 then
    raise exception 'contract failed: default retention deleted %, expected 1', v_deleted;
  end if;
  if (select count(*) from cron.job_run_details) <> 2 then
    raise exception 'contract failed: retention touched recent or running rows';
  end if;

  begin
    perform public.purge_cron_job_run_history(interval '6 days', 100);
    raise exception 'contract failed: unsafe retention interval was accepted';
  exception when others then
    if sqlerrm = 'contract failed: unsafe retention interval was accepted' then raise; end if;
  end;

  begin
    perform public.purge_cron_job_run_history(interval '30 days', 10001);
    raise exception 'contract failed: oversized retention batch was accepted';
  exception when others then
    if sqlerrm = 'contract failed: oversized retention batch was accepted' then raise; end if;
  end;

  begin
    perform public.purge_cron_job_run_history(interval '30 days', null);
    raise exception 'contract failed: null retention batch bypassed the deletion cap';
  exception when others then
    if sqlerrm = 'contract failed: null retention batch bypassed the deletion cap' then raise; end if;
  end;
end
$retention$;

do $$ begin raise notice 'PASS: cron IO cleanup schedules, guardrails, index, and retention'; end $$;
