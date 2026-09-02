-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
--
-- purge_community_organizer_follows (2026-09-01)
--
-- Scene handoff (WashedUp_The_Scene_User_Facing_Implementation_Handoff.pdf)
-- §16, "IMPORTANT DATA CORRECTION": "The generic fronting-target/follow
-- implementation currently allows community follow state. Resolve event
-- ownership first: community -> membership actions; organization -> follow
-- actions." §17's acceptance checklist repeats it ("Community cards/pages
-- never show Follow or follower counts") and its Avoid list bans "Using
-- Follow for a community or Join for an organization."
--
-- This build (backlog item community-follow-contradicts-scene-handoff)
-- already stops every CLIENT code path from reading or writing a
-- community-kind row in organizer_follows:
--   - app/event/[id].tsx no longer fetches follow state or a follower count
--     for a community-fronted event (a new `followTarget`, narrowed to
--     organizer only, replaces the old `frontingTarget` for that purpose).
--   - lib/organizerFollows.ts's FollowTarget type is organizer-only now, so
--     a community target fails to type-check rather than silently working.
-- This migration is the data-side half of that same decision: purge any
-- community-kind rows that already exist, so a stale one can never surface
-- through follower_broadcasts' own community_id RLS branch
-- (20260818180000_follower_broadcasts_o03.sql lines ~89-93) or any future
-- direct read of organizer_follows.
--
-- Why a DELETE only, no new CHECK constraint: no migration in this repo
-- creates organizer_follows itself (proposal 68's table -- every client
-- comment describes it as "self-flipping," i.e. dormant/applied out of band
-- if it exists at all today). Without the real committed DDL to read,
-- guessing at column nullability or an index name for a new constraint
-- risks a migration that does not even apply cleanly. This file is
-- deliberately narrow and defensive: it is a safe no-op wherever the table
-- (or its community_id column) does not exist yet, anywhere this runs.
--
-- Josh: once you can see organizer_follows's real DDL, a follow-up
-- migration can add `CHECK (organizer_user_id IS NOT NULL AND community_id
-- IS NULL)` (or drop the community_id column outright) to make this
-- permanent at the schema level -- this file does not attempt that blind.
-- Separately: if a DB-side trigger auto-inserts an organizer_follows row on
-- community join (referenced in app/event/[id].tsx's old T9/doc-121
-- comment, "joining auto-follows DB-side"), it isn't in this repo's
-- migrations either and would keep recreating exactly the rows this file
-- deletes -- worth finding and retiring it once located, otherwise this
-- cleanup is a one-time snapshot, not a lasting fix.

do $$
begin
  if to_regclass('public.organizer_follows') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'organizer_follows'
         and column_name = 'community_id'
     )
  then
    execute 'delete from public.organizer_follows where community_id is not null';
  end if;
end $$;
