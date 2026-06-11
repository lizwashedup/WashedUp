-- ===========================================================================
-- NOT YET APPLIED. Batch 3, file 5/8. Reviewed at the batch-3 checkpoint;
-- applied to prod only on explicit go-ahead, in the batch order.
--
-- Audit decision (Liz, 2026-06-10): keep circle-covers world-readable, but add a
-- file-size limit. The bucket is currently public with file_size_limit = NULL, so
-- it inherits the project-global cap. Covers are a single compressed image; cap
-- at 10 MB (Liz-confirmed).
--
-- Idempotent storage config (no row to roll back); guarded with a read-back
-- assertion so a wrong value fails loudly rather than silently.
-- ===========================================================================
BEGIN;

UPDATE storage.buckets
SET file_size_limit = 10485760   -- 10 MB
WHERE id = 'circle-covers';

DO $$
DECLARE
  v_limit bigint;
BEGIN
  SELECT file_size_limit INTO v_limit FROM storage.buckets WHERE id = 'circle-covers';
  IF v_limit IS DISTINCT FROM 10485760 THEN
    RAISE EXCEPTION 'circle-covers file_size_limit not set as expected, got %', v_limit;
  END IF;
  RAISE NOTICE 'circle-covers file_size_limit = 10 MB confirmed';
END $$;

COMMIT;
