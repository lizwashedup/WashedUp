-- Community event chats close 48 hours after the event ends. Keep the old
-- archived flag and historical reads; only the event timer and new writes
-- change. This migration is prepared in an isolated copy, not applied live.

comment on column public.community_topics.explore_event_id is
  'Set for a community event attendee chat; new messages close 48 hours after event end (falling back to start/date), and existing history remains readable.';

-- A daily archive job can run many hours after the displayed deadline.
-- Enforce the deadline at insert time even between scheduler runs.
drop policy if exists community_topic_messages_insert on public.community_topic_messages;
create policy community_topic_messages_insert on public.community_topic_messages
  for insert with check (
    sender_id = (select auth.uid())
    and is_topic_member(topic_id, (select auth.uid()))
    and exists (
      select 1
      from public.community_topics t
      left join public.explore_events e on e.id = t.explore_event_id
      where t.id = community_topic_messages.topic_id
        and not t.archived
        and (is_community_member(t.community_id, (select auth.uid()))
             or t.explore_event_id is not null)
        and (
          t.explore_event_id is null
          or (
            e.id is not null
            and (
              coalesce(e.end_time, e.start_time, e.event_date::timestamptz) is null
              or now() < coalesce(e.end_time, e.start_time, e.event_date::timestamptz) + interval '48 hours'
            )
          )
        )
    )
  );

-- cron.schedule upserts this named job. Archive within a minute of the
-- deadline so client lists and attachment/reaction gates use the same state.
select cron.schedule(
  'archive-community-event-topics',
  '* * * * *',
  $cron$
  update public.community_topics t
  set archived = true
  where t.explore_event_id is not null
    and not t.archived
    and exists (
      select 1 from public.explore_events e
      where e.id = t.explore_event_id
        and coalesce(e.end_time, e.start_time, e.event_date::timestamptz) <= now() - interval '48 hours'
    );
  $cron$
);
