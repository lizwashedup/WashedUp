-- Personal-account prerequisite; preserves canonical withdrawn resubmission.
-- Depends on 20260819010000 and 20260906190000. No grants/assent/contact backfill.
BEGIN;
DO $prerequisites$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.operator_grant_status'::regtype AND enumlabel='withdrawn') THEN
  RAISE EXCEPTION 'Apply 20260819010000_operator_grant_status_withdrawn first';
 END IF;
 IF md5(pg_get_functiondef('public.submit_operator_application(public.operator_track,jsonb,boolean)'::regprocedure)) <> 'ce9371bf5a19e9f4f3f1972a135a9ca5' THEN
  RAISE EXCEPTION 'Expected canonical withdrawn-capable application RPC; review definition drift before applying';
 END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='operator_grants' AND cmd IN('INSERT','ALL'))<>1
  OR NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='operator_grants' AND policyname='operator_grants_insert' AND cmd='INSERT' AND roles=ARRAY['public']::name[] AND permissive='PERMISSIVE' AND with_check=$check$((user_id = ( SELECT uid() AS uid)) AND (status = 'applied'::operator_grant_status) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (review_notes IS NULL))$check$) THEN
  RAISE EXCEPTION 'Application insert policy drift; review before applying';
 END IF;
END $prerequisites$;
CREATE OR REPLACE FUNCTION public.submit_operator_application(
  p_track public.operator_track,
  p_application jsonb,
  p_accept_terms boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_status public.operator_grant_status;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.id=v_uid AND NOT coalesce(u.is_anonymous,false)) THEN
    RAISE EXCEPTION 'Register or sign in to your personal account first' USING ERRCODE='42501';
  END IF;
  IF p_accept_terms IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'The creator terms must be accepted';
  END IF;
  IF p_application IS NULL OR jsonb_typeof(p_application) <> 'object' OR p_application = '{}'::jsonb THEN
    RAISE EXCEPTION 'Application answers are required';
  END IF;

  SELECT id, status INTO v_id, v_status
  FROM operator_grants
  WHERE user_id = v_uid AND track = p_track;

  IF v_id IS NULL THEN
    INSERT INTO operator_grants (user_id, track, status, application, terms_accepted_at)
    VALUES (v_uid, p_track, 'applied', p_application, now())
    RETURNING id INTO v_id;
  ELSIF v_status IN ('declined', 'needs_more_info', 'withdrawn') THEN
    -- a resubmitted application carries no stale review state (unchanged from the
    -- original fix 2, 2026-07-03; 'withdrawn' added here, 2026-09-06)
    UPDATE operator_grants
    SET application = p_application,
        status = 'applied',
        terms_accepted_at = now(),
        reviewed_by = NULL,
        reviewed_at = NULL,
        applicant_message = NULL
    WHERE id = v_id;
  ELSIF v_status IN ('applied', 'in_review') THEN
    RAISE EXCEPTION 'Your application is already being read';
  ELSIF v_status = 'approved' THEN
    RAISE EXCEPTION 'This application is already approved';
  ELSE
    RAISE EXCEPTION 'This application cannot be resubmitted';  -- revoked (the only status left)
  END IF;

  RETURN v_id;
END;
$$;

-- All client submissions require the identity/explicit-consent RPC.
DROP POLICY operator_grants_insert ON public.operator_grants;
COMMIT;
