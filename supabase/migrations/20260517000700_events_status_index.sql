-- Yours page rebuild — 8/8: supporting index for the Yours read RPCs.
--
-- REVIEW ONLY. Not applied by the agent. Additive and safe to ship ahead of
-- the flag flip (pure index, no behavior change).
--
-- Why: several Yours read RPCs filter events by status (and often by
-- start_time alongside it):
--   * get_yours_grid       — upcoming CTE: e.status IN ('forming','active','full') AND e.start_time >= now()
--   * get_plan_history_backlog / get_profile_card — e.status = 'completed'
-- Prod `events` currently has no index on `status`, so at 10k+ users these
-- become sequential scans inside the Yours RPCs. A composite (status,
-- start_time) index serves both the equality and the range filter.
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so
-- this migration is intentionally NOT wrapped in BEGIN/COMMIT and has no
-- transactional self-test. CONCURRENTLY avoids a write lock on `events`
-- (which is hot in production). If the chosen apply tool forces a
-- transaction, drop the word CONCURRENTLY (accepting a brief lock) — the
-- IF NOT EXISTS keeps it idempotent either way.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_status_start
  ON public.events (status, start_time);
