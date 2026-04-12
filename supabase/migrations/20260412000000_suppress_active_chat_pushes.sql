-- ══════════════════════════════════════════════════════════════════════
-- Suppress push notifications for the chat a user is currently viewing
--
-- Goal: when Jessica sends a message and Liz is actively on the Beach
-- Day chat screen, don't fire a push to Liz's device. She's already
-- watching messages arrive live via Supabase realtime; a banner plus
-- haptic for a message she just saw is noise. The app_notifications
-- row is still created (so inbox / unread counters still work), but
-- the edge function marks it push_suppressed and skips the Expo call.
--
-- Two columns:
--   profiles.active_chat_event_id  — which chat the user is in right
--     now (null if they're not in a chat or the app is backgrounded).
--     The client writes to this on chat focus and clears it on blur,
--     background, or unmount.
--   app_notifications.push_suppressed — sticky flag set by the edge
--     function when the target user was in the matching chat at send
--     time. The edge function excludes suppressed rows from future
--     runs so we never deliver a stale push after the moment passed.
-- ══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists active_chat_event_id uuid
    references public.events(id) on delete set null;

alter table public.app_notifications
  add column if not exists push_suppressed boolean not null default false;

-- Partial index: the edge function only cares about profiles whose
-- active_chat_event_id matches a specific event, so we only index the
-- non-null subset.
create index if not exists idx_profiles_active_chat_event_id
  on public.profiles(active_chat_event_id)
  where active_chat_event_id is not null;
