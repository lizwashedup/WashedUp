-- Documentation-only. Applied directly in production Supabase on 2026-04-05.
-- Complete waitlist system overhaul: tiered notifications, dynamic timeouts,
-- auto-cleanup on join, creator notifications, expired waitlist cascade.

-- 1. Add notified_at timestamp for timeout tracking
ALTER TABLE event_waitlist ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- 2. Rewrite notify_waitlist_on_spot_open: tiered FIFO, dynamic timeout
--    Under 24h: notify ALL waitlisters (urgent, go public)
--    24h+: notify first N where N = open spots (FIFO by created_at)
-- (See function body in production)

-- 3. Update create_waitlist_spot_notification: dynamic expiry
--    7+ days out: 4 hour timeout
--    2-7 days: 2 hour timeout
--    24-48 hours: 2 hour timeout
--    Under 24h: 30 min window

-- 4. New: process_expired_waitlist() cascades to next person
--    Called by expire_stale_notifications (which runs before every push send)

-- 5. New: notify_creator_waitlist_join trigger on event_waitlist INSERT
--    Sends "Someone is waiting to join!" notification to plan creator

-- 6. New: cleanup_waitlist_on_join trigger on event_members INSERT
--    Deletes waitlist row when user actually joins the plan

-- 7. New: cleanup_waitlist_on_rejoin trigger on event_members UPDATE
--    Same cleanup for re-join (status changed to 'joined')

-- 8. New: notify_waitlist_on_member_delete trigger on event_members DELETE
--    Handles hard-delete case (account deletion) that the UPDATE trigger misses

-- 9. Updated expire_stale_notifications to also call process_expired_waitlist()
