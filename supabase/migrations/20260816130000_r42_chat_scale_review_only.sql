-- R42 REVIEW ONLY: additive indexes for 60-row, newest-first chat pages.
-- Do not apply until the query-plan review is approved. This migration changes
-- no data, policies, functions, or columns.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_event_created_id_desc
  ON public.messages (event_id, created_at DESC, id DESC)
  WHERE event_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_circle_created_id_desc
  ON public.messages (circle_id, created_at DESC, id DESC)
  WHERE circle_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_community_topic_messages_topic_created_id_desc
  ON public.community_topic_messages (topic_id, created_at DESC, id DESC);
