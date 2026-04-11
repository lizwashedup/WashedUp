-- ══════════════════════════════════════════════════════════════════════
-- Add welcome_seen_at to profiles
--
-- Source of truth for "has the user seen the first-open welcome modal".
-- Previously this lived only in AsyncStorage under has_seen_welcome_<id>,
-- but that flag is lost on reinstall / dev rebuild / local storage clear,
-- so existing users were re-seeing the welcome modal on every fresh build.
-- Supabase-backed flag survives device / install changes.
-- ══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists welcome_seen_at timestamptz;

-- Backfill existing users: treat their account creation date as the welcome
-- timestamp so pre-existing accounts never re-see the modal, even though
-- their local AsyncStorage flag may have been wiped by a reinstall / dev
-- rebuild before this column existed.
update public.profiles
  set welcome_seen_at = created_at
  where welcome_seen_at is null;
