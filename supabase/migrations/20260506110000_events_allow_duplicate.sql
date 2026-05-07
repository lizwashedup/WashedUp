-- events.allow_duplicate: per-plan opt-out from the "post a duplicate plan"
-- offer that shows when the plan is full. Defaults true so existing rows
-- keep current behavior; creators can uncheck the new toggle on the post
-- screen if they don't want their plan duplicated.
--
-- Documentation-only. Applied directly in production Supabase on 2026-05-06.
--
-- No RPC changes — the duplicate gate is enforced entirely in the client
-- (plan detail page hides the sheet when this is false).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS allow_duplicate boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='events' AND column_name='allow_duplicate'
  ) THEN
    RAISE EXCEPTION 'allow_duplicate column missing after ADD COLUMN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='events' AND column_name='allow_duplicate'
      AND data_type='boolean' AND is_nullable='NO' AND column_default='true'
  ) THEN
    RAISE EXCEPTION 'allow_duplicate column shape wrong (expected boolean NOT NULL DEFAULT true)';
  END IF;
END
$$ LANGUAGE plpgsql;
