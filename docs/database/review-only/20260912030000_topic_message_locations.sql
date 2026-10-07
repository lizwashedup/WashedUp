-- REVIEW ONLY. Apply only after deployed schema/policy inspection and DB-copy
-- tests. Community and community-event chats need the same pinned location
-- messages as Plan chats. Existing text and photo rows remain valid.

begin;

alter table public.community_topic_messages
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'community_topic_message_location_pair') then
    alter table public.community_topic_messages
      add constraint community_topic_message_location_pair check (
        (location_lat is null and location_lng is null)
        or (location_lat is not null and location_lng is not null
            and location_lat between -90 and 90 and location_lng between -180 and 180)
      );
  end if;
end $$;

commit;
