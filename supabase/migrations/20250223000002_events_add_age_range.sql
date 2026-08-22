-- Add age_range column to events table for the Post a Plan feature.
-- Run in Supabase SQL Editor before testing plan creation.
--
-- Guarded 2026-08-20: this file predates the explore_events schema by about
-- a year (no "events" table has ever existed in any tracked migration) and
-- already shows applied in production's own migration history, so it was
-- almost certainly hand-run once against an early prototype table, not
-- something a fresh replay should still expect to find. Wrapped so a clean
-- local `supabase start` (empty DB, migrations replayed in order) doesn't
-- crash on a table that was never created here -- production is untouched,
-- it never re-runs a migration already marked applied.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'events') then
    execute $sql$ALTER TABLE events ADD COLUMN IF NOT EXISTS age_range TEXT DEFAULT 'All Ages'$sql$;
  end if;
end $$;
