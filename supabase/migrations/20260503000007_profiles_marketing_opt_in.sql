-- profiles.marketing_opt_in: boolean flag for "keep me updated on plans and
-- events near me" set during onboarding step 1. Source of truth for whether
-- this user's email is registered with the Resend audience. The actual
-- registration happens via the add-to-resend-audience edge function — the
-- column persists the consent state and the function reads it before calling.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.marketing_opt_in IS
  'Set when the user opts in to "keep me updated on plans and events near me" during onboarding step 1. Source of truth for whether the address is registered with the Resend audience.';

-- Self-test
DO $do$
DECLARE
  v_data_type text;
  v_is_nullable text;
  v_default text;
BEGIN
  SELECT data_type, is_nullable, column_default
  INTO v_data_type, v_is_nullable, v_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'marketing_opt_in';

  IF v_data_type IS NULL THEN
    RAISE EXCEPTION 'self-test failed: profiles.marketing_opt_in column missing';
  END IF;
  IF v_data_type <> 'boolean' THEN
    RAISE EXCEPTION 'self-test failed: profiles.marketing_opt_in is %, expected boolean', v_data_type;
  END IF;
  IF v_is_nullable <> 'NO' THEN
    RAISE EXCEPTION 'self-test failed: profiles.marketing_opt_in is nullable, expected NOT NULL';
  END IF;
  IF v_default IS NULL OR position('false' IN v_default) = 0 THEN
    RAISE EXCEPTION 'self-test failed: profiles.marketing_opt_in default is %, expected false', COALESCE(v_default, '<none>');
  END IF;
END
$do$;
