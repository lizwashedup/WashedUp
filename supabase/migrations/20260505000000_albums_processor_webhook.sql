-- Albums v1: wire the album_uploads INSERT webhook to the Vercel-hosted
-- image processor at https://washedup.app/api/process-album-upload.
--
-- Documentation-only. Applied directly in production Supabase on 2026-05-05.
--
-- Depends on: 20260504210000_albums_v1_schema.sql (creates album_uploads).
--
-- The Sharp-based processor was deployed to washedup-web main today; the
-- ALBUM_PROCESSOR_WEBHOOK_SECRET env var is set in Vercel (Production scope).
-- Same secret is stored here in supabase_vault and read by the trigger
-- function on each fire.
--
-- Failure mode: net.http_post is async. If the function or network is down,
-- the trigger logs WARNING and still RETURN NEW so it never blocks the
-- underlying album_uploads INSERT. Async HTTP failures land in
-- net._http_response — see trigger_send_push_notifications for prior art.

-- 1. Store the shared secret in supabase_vault (encrypted at rest).
--    Idempotent: vault.create_secret raises if name conflicts, so wrap.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'album_processor_webhook_secret') THEN
    PERFORM vault.create_secret(
      '040a4d0de130883ca0aa4dd356c28cb883dbb0c0b4d9996037a3c1e4c83aeb3b',
      'album_processor_webhook_secret',
      'X-Webhook-Secret header for https://washedup.app/api/process-album-upload. Same value as Vercel ALBUM_PROCESSOR_WEBHOOK_SECRET env. Rotate by updating both.'
    );
  END IF;
END
$$ LANGUAGE plpgsql;

-- 2. Trigger function. Mirrors the body shape Supabase Database Webhooks
--    send (the Vercel route already understands {type, table, schema, record}).
CREATE OR REPLACE FUNCTION trg_album_uploads_webhook_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'album_processor_webhook_secret';

  PERFORM net.http_post(
    url := 'https://washedup.app/api/process-album-upload',
    body := jsonb_build_object(
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', TG_TABLE_SCHEMA,
      'record', row_to_json(NEW)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', v_secret
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the underlying INSERT on HTTP enqueue failure.
  RAISE WARNING 'trg_album_uploads_webhook_fn HTTP enqueue failed: % (SQLSTATE %)',
    SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$func$;

-- 3. Wire trigger.
DROP TRIGGER IF EXISTS trg_album_uploads_webhook ON album_uploads;
CREATE TRIGGER trg_album_uploads_webhook
AFTER INSERT ON album_uploads
FOR EACH ROW EXECUTE FUNCTION trg_album_uploads_webhook_fn();

-- 4. Self-test
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'album_processor_webhook_secret') THEN
    RAISE EXCEPTION 'webhook: vault secret missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'trg_album_uploads_webhook_fn'
  ) THEN
    RAISE EXCEPTION 'webhook: trigger function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_album_uploads_webhook'
  ) THEN
    RAISE EXCEPTION 'webhook: trigger missing';
  END IF;
END
$$ LANGUAGE plpgsql;
