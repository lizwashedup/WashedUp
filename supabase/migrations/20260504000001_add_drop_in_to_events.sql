-- Adds drop_in flag to events.
-- When false, the plan disappears from the public feed for non-members the
-- moment start_time passes (used for one-shot moments like a movie or a
-- dinner reservation). When true (default), the plan stays in the feed
-- until end_time (or start_time + 3h if end_time is null), matching the
-- existing "happening now" behavior.
-- end_time already exists from migration 20260327000001.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS drop_in boolean NOT NULL DEFAULT true;
