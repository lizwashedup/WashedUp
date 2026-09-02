-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- Add city to organizer_profiles (Scene handoff §12: the public organization
-- profile's minimum content is "name, logo, city, and concise bio" -
-- WashedUp_The_Scene_User_Facing_Implementation_Handoff.pdf, "Minimum page").
--
-- Same shape as 20260819000000_community_city.sql (communities.city, also
-- still DRAFT): a plain nullable text column, no default, no backfill.
-- Nullable at the column level so no existing organizer_profiles row is
-- broken by this migration - the app enforces nothing at the column level,
-- the same way community_city leaves "required before publish" as an
-- application-layer rule rather than a NOT NULL constraint.
--
-- ADDITIVE ONLY. NOT applied anywhere - sits in the repo until Josh applies
-- it. Until it lands, lib/organizerProfile.ts's getOrganizerCity/
-- setOrganizerCity read and write this column in isolation (same
-- self-flipping technique as lib/creatorMode.ts's getCommunityDiscoverable/
-- getJoinPolicy): a 42703 (column not applied yet) resolves to null/false
-- there and nowhere else, so the four-field organizer profile (name, logo,
-- bio, link) keeps working byte for byte whether or not this has landed.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.organizer_profiles') IS NULL THEN
    RAISE EXCEPTION 'dependency missing: organizer_profiles (20260713224144_organizer_profile_proposal_36.sql)';
  END IF;
END $$;

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS city text CHECK (city IS NULL OR char_length(city) BETWEEN 2 AND 60);

COMMENT ON COLUMN public.organizer_profiles.city IS
  'Scene handoff §12 minimum-page field for the public organization profile (app/organization/[id].tsx). Nullable: an organizer who saved a profile before this column existed, or who simply leaves it blank, renders the profile page without a city line rather than a fabricated one.';

-- ---------------------------------------------------------------------------
-- Self-test
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizer_profiles' AND column_name = 'city'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: organizer_profiles.city missing';
  END IF;
END;
$$;

-- behavioral self-test: the existing owner-write policy (organizer_profiles
-- is created/updated only by its own user_id, per 20260713224144) governs
-- this new column too since it is no different from bio/link_url to RLS -
-- prove a stray too-short value is rejected and a real one lands, using the
-- same simulated-JWT technique 20260713224144's own probes use. Skips (does
-- not fail) if it cannot find a safe temp id to probe with, same house
-- convention as other self-tests in this repo that need a real auth.uid().
DO $$
DECLARE
  v_uid uuid := 'cafe0002-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO public.organizer_profiles (user_id, display_name)
  VALUES (v_uid, 'city selftest')
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  BEGIN
    EXECUTE 'set local role authenticated';
    UPDATE public.organizer_profiles SET city = 'x' WHERE user_id = v_uid;
    RAISE EXCEPTION 'SELF-TEST FAIL: a 1-character city was accepted (CHECK constraint not enforced)';
  EXCEPTION
    WHEN check_violation THEN NULL; -- expected
  END;
  UPDATE public.organizer_profiles SET city = 'Los Angeles' WHERE user_id = v_uid;
  EXECUTE 'reset role';
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT EXISTS (SELECT 1 FROM public.organizer_profiles WHERE user_id = v_uid AND city = 'Los Angeles') THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a valid city did not save';
  END IF;

  DELETE FROM public.organizer_profiles WHERE user_id = v_uid AND display_name = 'city selftest';
  RAISE NOTICE 'organizer_profiles.city self-test passed';
END $$;

COMMIT;
