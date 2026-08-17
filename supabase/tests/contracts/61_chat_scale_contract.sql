\set ON_ERROR_STOP on

DO $$
DECLARE
  actual uuid[];
  index_name text;
BEGIN
  FOREACH index_name IN ARRAY ARRAY[
    'idx_messages_event_created_id_desc',
    'idx_messages_circle_created_id_desc',
    'idx_community_topic_messages_topic_created_id_desc'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = index_name) THEN
      RAISE EXCEPTION 'chat scale contract missing index %', index_name;
    END IF;
  END LOOP;

  SELECT array_agg(id ORDER BY created_at DESC, id DESC) INTO actual
  FROM (
    SELECT id, created_at FROM public.messages
    WHERE event_id = '90000000-0000-0000-0000-000000000001'
      AND (created_at < '2026-08-16T12:00:00Z'
        OR (created_at = '2026-08-16T12:00:00Z' AND id < '10000000-0000-0000-0000-000000000002'))
    ORDER BY created_at DESC, id DESC
    LIMIT 60
  ) event_page_two;
  IF actual <> ARRAY['10000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000000'::uuid] THEN
    RAISE EXCEPTION 'event cursor skipped or duplicated a same-timestamp row: %', actual;
  END IF;

  SELECT array_agg(id ORDER BY created_at DESC, id DESC) INTO actual
  FROM (
    SELECT id, created_at FROM public.messages
    WHERE circle_id = '91000000-0000-0000-0000-000000000001'
      AND (created_at < '2026-08-16T12:00:00Z'
        OR (created_at = '2026-08-16T12:00:00Z' AND id < '20000000-0000-0000-0000-000000000002'))
    ORDER BY created_at DESC, id DESC
    LIMIT 60
  ) circle_page_two;
  IF actual <> ARRAY['20000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000000'::uuid] THEN
    RAISE EXCEPTION 'circle cursor skipped or duplicated a same-timestamp row: %', actual;
  END IF;

  SELECT array_agg(id ORDER BY created_at DESC, id DESC) INTO actual
  FROM (
    SELECT id, created_at FROM public.community_topic_messages
    WHERE topic_id = '92000000-0000-0000-0000-000000000001'
      AND (created_at < '2026-08-16T12:00:00Z'
        OR (created_at = '2026-08-16T12:00:00Z' AND id < '30000000-0000-0000-0000-000000000002'))
    ORDER BY created_at DESC, id DESC
    LIMIT 60
  ) topic_page_two;
  IF actual <> ARRAY['30000000-0000-0000-0000-000000000001'::uuid, '30000000-0000-0000-0000-000000000000'::uuid] THEN
    RAISE EXCEPTION 'topic cursor skipped or duplicated a same-timestamp row: %', actual;
  END IF;
END $$;

SELECT 'PASS R42 chat scale contract: event, circle, and topic cursors retain same-timestamp rows' AS result;
