-- admin_cascade_delete_user: wraps the 7 user-deletion DELETEs that
-- supabase/functions/admin-manage-user/index.ts previously fired inline
-- into a single transaction.
--
-- Why: the prior shape fired 7 separate `supabaseAdmin.from(...).delete()`
-- calls sequentially over HTTP. Each one auto-committed. If the 6th call
-- failed (FK conflict, RLS denial, transient connection drop), the first
-- 5 had already deleted rows and there was no rollback. The user's auth
-- record might or might not be banned depending on where the failure hit,
-- leaving data in a half-deleted state that's expensive to clean up.
--
-- Wrapping the deletes in a single Postgres function moves them inside one
-- transaction: any thrown error rolls back ALL of them. The auth ban call
-- stays in the edge fn after the RPC succeeds because Supabase Auth schema
-- operations cannot be performed inside a public.* transaction.
--
-- Most of the FKs to public.profiles already have ON DELETE CASCADE, so
-- some of the manual deletes are redundant with the final DELETE FROM
-- profiles. Preserving the original 7 statements 1:1 to keep behavior
-- identical to the pre-fix code; the redundant ones are no-ops on the
-- second pass (cascade has already cleared the rows). The two that are
-- strictly required (no FK to profiles): chat_reads, reports. The one
-- with a SET NULL FK (not cascade): messages. Profiles last triggers
-- the cascade for ~30 child tables.

CREATE OR REPLACE FUNCTION public.admin_cascade_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Same order and predicates as the pre-2026-05-20 inline edge fn so
  -- behavior is preserved exactly. Wrapped in this function = wrapped in
  -- a single implicit transaction = atomic.
  DELETE FROM messages WHERE user_id = p_user_id;
  DELETE FROM event_members WHERE user_id = p_user_id;
  DELETE FROM chat_reads WHERE user_id = p_user_id;
  DELETE FROM friends WHERE user_id = p_user_id OR friend_id = p_user_id;
  DELETE FROM reports WHERE reporter_user_id = p_user_id OR reported_user_id = p_user_id;
  DELETE FROM events WHERE creator_user_id = p_user_id;
  DELETE FROM profiles WHERE id = p_user_id;
END;
$$;

-- The function is only callable by the service role (i.e., the
-- admin-manage-user edge fn which is itself behind an admin_users check).
-- No other path should be able to invoke this.
REVOKE ALL ON FUNCTION public.admin_cascade_delete_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cascade_delete_user(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_cascade_delete_user(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cascade_delete_user(uuid) TO service_role;

-- ── Embedded self-test ───────────────────────────────────────────────────
-- Verifies the function exists, is SECURITY DEFINER, accepts the right
-- argument shape, and that the public/anon/authenticated grants are gone.
-- RAISE EXCEPTION aborts and rolls back the migration on any mismatch.
DO $$
DECLARE
  v_fns int;
  v_pub_can_exec boolean;
  v_anon_can_exec boolean;
  v_authed_can_exec boolean;
  v_service_can_exec boolean;
BEGIN
  SELECT COUNT(*) INTO v_fns
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'admin_cascade_delete_user'
    AND p.prosecdef
    AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid';
  IF v_fns <> 1 THEN
    RAISE EXCEPTION 'ASSERT: admin_cascade_delete_user missing or wrong shape (sec_def + p_user_id uuid)';
  END IF;

  SELECT has_function_privilege('public', 'public.admin_cascade_delete_user(uuid)', 'EXECUTE') INTO v_pub_can_exec;
  SELECT has_function_privilege('anon', 'public.admin_cascade_delete_user(uuid)', 'EXECUTE') INTO v_anon_can_exec;
  SELECT has_function_privilege('authenticated', 'public.admin_cascade_delete_user(uuid)', 'EXECUTE') INTO v_authed_can_exec;
  SELECT has_function_privilege('service_role', 'public.admin_cascade_delete_user(uuid)', 'EXECUTE') INTO v_service_can_exec;

  IF v_pub_can_exec THEN
    RAISE EXCEPTION 'ASSERT: PUBLIC should not be able to EXECUTE admin_cascade_delete_user';
  END IF;
  IF v_anon_can_exec THEN
    RAISE EXCEPTION 'ASSERT: anon should not be able to EXECUTE admin_cascade_delete_user';
  END IF;
  IF v_authed_can_exec THEN
    RAISE EXCEPTION 'ASSERT: authenticated should not be able to EXECUTE admin_cascade_delete_user';
  END IF;
  IF NOT v_service_can_exec THEN
    RAISE EXCEPTION 'ASSERT: service_role must be able to EXECUTE admin_cascade_delete_user';
  END IF;

  RAISE NOTICE 'admin_cascade_delete_user self-test passed';
END
$$;
