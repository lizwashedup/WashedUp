-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
--
-- Delta fix over 20260702190455_operator_applications.sql. Existing migration history is
-- immutable in this repo (see scripts/release/migration-policy.mjs), so this ships as a new
-- file rather than editing that file's bytes -- same precedent as 20260901060000,
-- 20260905010000/20260905020000/20260905030000, and 20260906160000.
--
-- Bug found reading the live code for Build 35 Screen 47 (creator access onboarding), whose
-- own gap is "resumable applications": app/creator/apply.tsx's statusLine() promises
-- "you withdrew this application. apply again anytime." for a 'withdrawn' operator_grants
-- row, and both app/creator/apply-events.tsx and apply-community.tsx now prefill the form
-- from that prior application (this session's own fix, alongside this migration) so the
-- resume is genuine. But 'withdrawn' (added by 20260819010000, an enum value) was never
-- added to submit_operator_application()'s resubmit branch, which predates it
-- (20260702190455). A withdrawn application therefore falls into the function's final ELSE
-- and raises "This application cannot be resubmitted" -- the exact error a genuinely
-- platform-revoked applicant gets. Withdrawing is the applicant's own reversible choice, not
-- a decision (distinct from 'revoked', see that enum's own comment); reapplying after
-- withdrawing should behave exactly like reapplying after 'declined' or 'needs_more_info'
-- already does, and today it does not.
--
-- Fix: add 'withdrawn' to the same resubmit branch 'declined'/'needs_more_info' already use
-- (clears stale review state, sets status back to 'applied'). Nothing else changes --
-- CREATE OR REPLACE re-declares submit_operator_application() byte-for-byte against the
-- 2026-07-02 original except that one IN-list. Existing REVOKE/GRANT EXECUTE from that
-- migration are untouched by CREATE OR REPLACE (privileges attach to the function's
-- name+signature, not to the CREATE statement instance), so they are not repeated here.
--
-- NOT applied anywhere, NOT run against a live or disposable Postgres this session (the
-- disposable local harness referenced in crucible-T5315's 2026-09-01 handoff was still down)
-- -- same honesty-about-untested-status convention as this repo's other DRAFT delta-fix
-- migrations. Needs a real apply-and-test pass before this can ever be called done, per this
-- repo's own Release Discipline (clients/washed-up/CLAUDE.md).

BEGIN;

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
  IF NOT p_accept_terms THEN
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

-- ---------------------------------------------------------------------------
-- self-test: the one behavior this migration changes (never strip on apply)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_applicant uuid;
  v_grant uuid;
  v_status public.operator_grant_status;
BEGIN
  SELECT id INTO v_applicant FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = u.id)
    AND NOT public.has_role(u.id, 'admin'::app_role)
    AND NOT EXISTS (SELECT 1 FROM public.operator_grants g WHERE g.user_id = u.id)
  ORDER BY created_at LIMIT 1;
  IF v_applicant IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs a non-admin user with no existing operator_grants row to run';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_applicant, 'role', 'authenticated')::text, true);

  -- apply, then withdraw (withdraw_operator_application allows this from 'applied')
  v_grant := public.submit_operator_application(
    'event_host', '{"applicant_type":"just_me","about":"self test"}'::jsonb, true);
  PERFORM public.withdraw_operator_application(v_grant);
  SELECT status INTO v_status FROM public.operator_grants WHERE id = v_grant;
  IF v_status <> 'withdrawn' THEN
    RAISE EXCEPTION 'SELF-TEST SETUP FAIL: withdraw did not land (got %)', v_status;
  END IF;

  -- the fix under test: resubmitting a withdrawn application must succeed, not raise
  -- "This application cannot be resubmitted"
  PERFORM public.submit_operator_application(
    'event_host', '{"applicant_type":"just_me","about":"resubmit after withdraw"}'::jsonb, true);
  SELECT status INTO v_status FROM public.operator_grants WHERE id = v_grant;
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: resubmit after withdrawn did not land as applied (got %)', v_status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.operator_grants
    WHERE id = v_grant AND (reviewed_by IS NOT NULL OR reviewed_at IS NOT NULL OR applicant_message IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: resubmit after withdrawn left stale review state';
  END IF;

  DELETE FROM public.operator_grants WHERE id = v_grant;
  PERFORM set_config('request.jwt.claims', null, true);

  RAISE NOTICE 'operator application withdraw-then-resubmit self-test passed';
END;
$$;

COMMIT;
