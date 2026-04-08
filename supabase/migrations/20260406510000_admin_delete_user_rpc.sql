-- Replace broken Supabase admin API delete with direct SQL delete
-- The admin API was returning 500 errors; this bypasses it via SECURITY DEFINER
CREATE OR REPLACE FUNCTION admin_delete_user_by_id(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', target_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_user_by_id(uuid) TO service_role;
