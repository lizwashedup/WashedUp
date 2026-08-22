-- ============================================================================
-- fix: community event-room chat auto-archive keyed to event START, not END
-- (confirmed live 2026-08-19: cron job id 29, "archive-community-event-topics",
-- runs daily 10:17am UTC. Its live command used
-- coalesce(e.start_time, e.event_date::timestamptz), never e.end_time, even
-- though end_time exists and is used elsewhere in this repo. A multi-day
-- event's room could lock itself 48h after it STARTED, while the event was
-- still happening.)
--
-- cron.schedule() upserts by job name, so re-running this replaces the
-- existing job's command in place -- no separate drop/unschedule needed.
--
-- NOT applied anywhere -- written 2026-08-19, needs a separate go-ahead
-- since it touches a running cron job real chat data already flows through.
-- ============================================================================

select cron.schedule(
  'archive-community-event-topics',
  '17 10 * * *',
  $cron$
  update public.community_topics t
  set archived = true
  where t.explore_event_id is not null
    and not t.archived
    and exists (
      select 1 from public.explore_events e
      where e.id = t.explore_event_id
        and coalesce(e.end_time, e.start_time, e.event_date::timestamptz) < now() - interval '48 hours'
    );
  $cron$
);
