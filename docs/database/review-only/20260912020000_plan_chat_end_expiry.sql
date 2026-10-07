-- REVIEW ONLY — do not apply before reading the deployed policy inventory.
-- Align Plan chat writes with the client: 48 hours after the stored end,
-- falling back to start when no valid end exists. History stays readable.
--
-- Deployment gate: inspect pg_policies for public.messages, verify the exact
-- existing "Event members can send messages" definition and any OR-combining
-- INSERT policies, then run an authenticated two-user expiry contract on a
-- database copy. This file is not an active migration.

begin;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages'
      and policyname = 'Event members can send messages'
  ) then
    raise exception 'Expected event-message insert policy is missing; inspect deployed policies before replacing it';
  end if;
end $$;

drop policy "Event members can send messages" on public.messages;
create policy "Event members can send messages" on public.messages
  for insert to authenticated
  with check (
    event_id is not null
    and user_id = (select auth.uid())
    and exists (
      select 1 from public.event_members em
      where em.event_id = messages.event_id
        and em.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.events e
      where e.id = messages.event_id
        and now() < (
          case when e.end_time is not null and e.end_time > e.start_time
            then e.end_time else e.start_time end
        ) + interval '48 hours'
    )
  );

commit;
