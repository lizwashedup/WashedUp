-- Albums v0 → v1 cleanup: drop the partial v0 schema before rebuilding.
-- Documentation-only. Applied directly in production Supabase on 2026-05-05.
--
-- v0 (applied 2026-04-06) was never wired to client UI. plan_photos had 3
-- rows (all is_developing=false), no UI referenced it, no cron was calling
-- reveal_album_photos (no pg_cron job for it). Clean rebuild path.
--
-- Did NOT touch:
--   * plan_attendance (kept; v1 still uses it as the was_present source of truth)
--   * plan-albums storage bucket or its 3 orphan objects (cheap to retain)

DROP FUNCTION IF EXISTS public.reveal_album_photos();
DROP TABLE IF EXISTS public.plan_photos CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plan_photos') THEN
    RAISE EXCEPTION 'drop_album_v0: plan_photos still exists after DROP';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'reveal_album_photos') THEN
    RAISE EXCEPTION 'drop_album_v0: reveal_album_photos() still exists after DROP';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plan_attendance') THEN
    RAISE EXCEPTION 'drop_album_v0: plan_attendance was unexpectedly removed';
  END IF;
END
$$ LANGUAGE plpgsql;
