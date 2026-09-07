-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- Add support_email to organizer_profiles (Build 35 Screen 42: the delta
-- matrix names "website and support-email fields" as unverified against the
-- current table. Verified this session by reading 20260713224144_organizer_
-- profile_proposal_36.sql directly: the table has display_name, logo_url,
-- bio, link_url, plus the later DRAFT city column -- no support_email column
-- exists anywhere. link_url already carries the "website" half (the editor's
-- own copy: "your site, instagram, wherever people find you"), so only
-- support_email is genuinely missing.
--
-- Same shape as 20260901130000_organizer_profile_city.sql: a plain nullable
-- text column, no default, no backfill, additive only. Nullable at the
-- column level so no existing organizer_profiles row is broken -- whether a
-- support contact is required before publish stays an application-layer
-- rule, not a NOT NULL constraint, matching city's own precedent.
--
-- A light shape check only (contains '@', no whitespace) -- the same
-- "structure, not deliverability" standard already used elsewhere in this
-- schema (see onboarding email validation), not a full RFC 5322 validator.
--
-- ADDITIVE ONLY. NOT applied anywhere - sits in the repo until Josh applies
-- it. Until it lands, lib/organizerProfile.ts's getOrganizerSupportEmail/
-- setOrganizerSupportEmail read and write this column in isolation (same
-- self-flipping technique as getOrganizerCity/setOrganizerCity, and
-- lib/creatorMode.ts's getCommunityDiscoverable/getJoinPolicy before that): a
-- 42703 (column not applied yet) resolves to null there and nowhere else, so
-- the four-field organizer profile (name, logo, bio, link) plus city keep
-- working byte for byte whether or not this has landed.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organizer_profiles') IS NULL THEN
    RAISE EXCEPTION 'dependency missing: organizer_profiles (20260713224144_organizer_profile_proposal_36.sql)';
  END IF;
END $$;

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS support_email text
    CHECK (
      support_email IS NULL
      OR (
        char_length(support_email) <= 254
        AND support_email LIKE '%@%'
        AND support_email !~ '\s'
      )
    );

COMMENT ON COLUMN public.organizer_profiles.support_email IS
  'Build 35 Screen 42: a real contact address for this organization, distinct from the personal account email. Nullable: an organizer who saved a profile before this column existed, or who leaves it blank, renders the public organization page without a support line rather than a fabricated one.';

-- ---------------------------------------------------------------------------
-- Self-test
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizer_profiles' AND column_name = 'support_email'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: organizer_profiles.support_email missing';
  END IF;
END;
$$;

-- behavioral self-test: the existing owner-write policy (organizer_profiles
-- is created/updated only by its own user_id, per 20260713224144) governs
-- this new column too since it is no different from bio/link_url/city to
-- RLS -- prove a shapeless value is rejected and a real one lands, same
-- simulated-JWT technique the city migration's own self-test uses.
DO $$
DECLARE
  v_uid uuid := 'cafe0003-0000-0000-0000-000000000003';
BEGIN
  INSERT INTO public.organizer_profiles (user_id, display_name)
  VALUES (v_uid, 'support email selftest')
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'set local role authenticated';
    UPDATE public.organizer_profiles SET support_email = 'not an email' WHERE user_id = v_uid;
    RAISE EXCEPTION 'SELF-TEST FAIL: a shapeless support_email was accepted (CHECK constraint not enforced)';
  EXCEPTION
    WHEN check_violation THEN NULL; -- expected
  END;
  UPDATE public.organizer_profiles SET support_email = 'help@example.com' WHERE user_id = v_uid;
  EXECUTE 'reset role';
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.organizer_profiles WHERE user_id = v_uid AND support_email = 'help@example.com'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a valid support_email did not save';
  END IF;

  DELETE FROM public.organizer_profiles WHERE user_id = v_uid AND display_name = 'support email selftest';
  RAISE NOTICE 'organizer_profiles.support_email self-test passed';
END $$;

COMMIT;
