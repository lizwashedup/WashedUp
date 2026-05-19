-- Suppress album-upload push notification spam (album-bugs-may18 Bug 1, P0).
--
-- Problem: trg_album_upload_after_insert fires AFTER INSERT ON album_uploads
-- FOR EACH ROW and fans out one app_notifications row per uploaded asset x per
-- joined member. Uploading 20 photos blasts every member with ~20 pushes.
--
-- Decision (Liz, 2026-05-19): suppress album-upload notifications entirely for
-- now until a proper batched/published-album design ships. Smallest, fully
-- reversible change.
--
-- This DROPs only the notification fan-out trigger. It deliberately does NOT
-- touch:
--   * trg_album_uploads_webhook (the media processor webhook path), or
--   * trg_album_upload_after_insert_fn() (the function itself, which on prod
--     carries drift the repo migration never had: a cancelled/member_count<2
--     guard + actor_user_id column). Leaving the function intact means
--     re-enabling later is the single CREATE TRIGGER statement below.
--
-- The send-push-notifications edge function is untouched (fix is upstream).
--
-- Idempotent. Reversible: see the commented re-enable block at the bottom.

BEGIN;

DROP TRIGGER IF EXISTS trg_album_upload_after_insert ON public.album_uploads;

-- Self-test: assert the spam trigger is gone and the webhook processor trigger
-- still exists. Rolls the whole migration back on failure.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'album_uploads' AND t.tgname = 'trg_album_upload_after_insert'
  ) THEN
    RAISE EXCEPTION 'self-test failed: trg_album_upload_after_insert still present';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'album_uploads' AND t.tgname = 'trg_album_uploads_webhook'
  ) THEN
    RAISE EXCEPTION 'self-test failed: trg_album_uploads_webhook missing (processor path broken)';
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- TO RE-ENABLE album-upload notifications later, run exactly:
--
--   CREATE TRIGGER trg_album_upload_after_insert
--     AFTER INSERT ON public.album_uploads
--     FOR EACH ROW EXECUTE FUNCTION trg_album_upload_after_insert_fn();
--
-- (The function body is preserved as-is, including its prod drift.)
-- ---------------------------------------------------------------------------
