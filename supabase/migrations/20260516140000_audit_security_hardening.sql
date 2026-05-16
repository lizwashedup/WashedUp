-- Audit remediation P1: close two real security gaps + add the missing FK index.
--
-- Applied directly to production Supabase (preview branches are broken for this
-- repo). Single transaction; embedded DO-block self-tests RAISE EXCEPTION to
-- force rollback on any failure.
--
-- 1. public.bot_watch_cleared — RLS was DISABLED with full anon/authenticated
--    DML grants (Supabase advisor lint 0013 ERROR). No app code and no DB
--    function references this table (verified), so it is internal/service_role
--    tooling only. Enable RLS (no policies = deny anon/authenticated;
--    service_role + postgres bypass RLS so internal tooling is unaffected) and
--    revoke the table grants as defense in depth.
-- 2. public.archive_empty_albums() — cron-only SECURITY DEFINER fn that is
--    EXECUTE-able by anon/authenticated (Supabase default grant the prior
--    migration's REVOKE FROM PUBLIC did not strip). Revoke from anon +
--    authenticated; cron runs as the job owner / service_role.
-- 3. album_user_metadata.cover_upload_id FK had no covering index
--    (advisor lint 0001). Tiny table; plain index inside the txn.

BEGIN;

-- 1. bot_watch_cleared
ALTER TABLE public.bot_watch_cleared ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bot_watch_cleared FROM anon, authenticated;

-- 2. archive_empty_albums (cron only)
REVOKE EXECUTE ON FUNCTION public.archive_empty_albums() FROM anon, authenticated;

-- 3. covering index for the new FK
CREATE INDEX IF NOT EXISTS idx_album_user_metadata_cover_upload_id
  ON public.album_user_metadata (cover_upload_id);

-- Self-tests
DO $$
DECLARE v_rls boolean; v_bad int; v_idx int;
BEGIN
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid='public.bot_watch_cleared'::regclass;
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'self-test: RLS not enabled on bot_watch_cleared';
  END IF;

  SELECT count(*) INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='bot_watch_cleared'
    AND grantee IN ('anon','authenticated');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'self-test: anon/authenticated still have grants on bot_watch_cleared (%).', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM information_schema.role_routine_grants
  WHERE routine_schema='public' AND routine_name='archive_empty_albums'
    AND grantee IN ('anon','authenticated') AND privilege_type='EXECUTE';
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'self-test: archive_empty_albums still EXECUTE-able by anon/authenticated (%).', v_bad;
  END IF;

  SELECT count(*) INTO v_idx
  FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
  JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(i.indkey)
  WHERE c.oid='public.album_user_metadata'::regclass AND a.attname='cover_upload_id';
  IF v_idx < 1 THEN
    RAISE EXCEPTION 'self-test: covering index on album_user_metadata.cover_upload_id missing';
  END IF;
END
$$ LANGUAGE plpgsql;

COMMIT;
