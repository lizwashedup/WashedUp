-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- Gender-restricted communities: close the Scene-tab visibility leak.
--
-- Gap found while reviewing the gender-restricted-communities build:
-- explore_events' own "Anyone can view live explore events" RLS policy is a
-- blanket `status = 'Live'` grant with no gender awareness at all, and it is
-- read DIRECTLY (not through any gender-aware RPC) by
-- lib/sceneDiscovery.ts's getSceneEvents(includeCommunityEvents) -- the
-- Scene tab, called with includeCommunityEvents=true whenever Communities
-- are enabled at all (components/scene/SceneDiscovery.tsx passes
-- communitiesEnabled straight through, confirmed by reading that call site).
-- Without this fix, a "Women of WashedUp" event (title, image, venue) stays
-- fully visible to a man on the Scene tab even after
-- get_discoverable_communities(), communities_select, and
-- request_to_join_community() are all correctly closed -- the exact "full
-- invisibility" promise the feature exists for, broken through a door
-- nobody had checked yet. A plan/event IS the community showing up, same
-- reasoning as the separate Plan-feed (get_filtered_feed) fix this build
-- already includes.
--
-- THE FIX: the community-owned branch of "Anyone can view live explore
-- events" additionally requires a gender match (or membership), mirroring
-- communities_select's own shape exactly. Standalone events (community_id
-- null) are completely untouched. A member of the owning community keeps
-- seeing its events regardless of their own gender (never a retroactive
-- lockout).
--
-- WHY A SEPARATE FILE: this build's other migrations (the
-- communities.restricted_gender schema, the request_to_join_community/
-- operator_create_explore_event changes, and the get_filtered_feed fix) were
-- found already in progress elsewhere while this ticket was being worked --
-- moving targets, mid-edit, on this same repo at the same time. Rather than
-- editing a sibling migration file someone else is actively writing, this
-- gap is closed as its own small, independently reviewable/re-sequenceable
-- addition. Depends on communities.restricted_gender existing, checked
-- below by COLUMN rather than by a specific migration filename for exactly
-- that reason -- apply whichever migration adds that column first, whatever
-- it ends up being named.
--
-- ADDITIVE ONLY (one RLS policy replace, same policy name, no new columns).
-- NOT applied anywhere; NOT tested against a real database (no DB access
-- used or authorized for this build) -- review and run against a prod clone
-- or the local harness before this is ever applied for real.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'communities' AND column_name = 'restricted_gender'
  ) THEN
    RAISE EXCEPTION 'dependency missing: communities.restricted_gender -- apply the gender-restricted-communities schema migration first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'explore_events'
      AND policyname = 'Anyone can view live explore events'
  ) THEN
    RAISE EXCEPTION 'dependency missing: explore_events "Anyone can view live explore events" policy';
  END IF;
END $$;

DROP POLICY IF EXISTS "Anyone can view live explore events" ON public.explore_events;

CREATE POLICY "Anyone can view live explore events" ON public.explore_events
  FOR SELECT USING (
    status = 'Live'
    AND (
      community_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM communities c
        WHERE c.id = explore_events.community_id AND c.restricted_gender IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM communities c
        WHERE c.id = explore_events.community_id
          AND c.restricted_gender = (SELECT p.gender FROM profiles p WHERE p.id = (select auth.uid()))
      )
      OR is_community_member(explore_events.community_id, (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- Self-test: functional pass against real woman/man profiles (skips, does
-- not fail, if neither exists to test with -- same house convention used
-- elsewhere in this exact feature's other migrations).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_woman uuid;
  v_man uuid;
  v_cid uuid;
  v_eid uuid;
BEGIN
  SELECT id INTO v_woman FROM public.profiles WHERE gender = 'woman' LIMIT 1;
  SELECT id INTO v_man FROM public.profiles WHERE gender = 'man' LIMIT 1;
  IF v_woman IS NULL OR v_man IS NULL THEN
    RAISE NOTICE 'SELF-TEST SKIPPED: needs a real woman profile and a real man profile to run';
    RETURN;
  END IF;

  INSERT INTO public.communities (handle, name, status, restricted_gender)
  VALUES ('selftest-scene-leak-tmp', 'self test scene leak', 'active', 'woman')
  RETURNING id INTO v_cid;

  INSERT INTO public.explore_events (title, category, status, community_id, host_user_id, start_time)
  VALUES ('selftest scene leak event', 'community', 'Live', v_cid, v_woman, now() + interval '1 day')
  RETURNING id INTO v_eid;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_man, 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM public.explore_events WHERE id = v_eid) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a women-only community''s Live event is directly readable by a man (Scene-tab leak not closed)';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_woman, 'role', 'authenticated')::text, true);
  IF NOT EXISTS (SELECT 1 FROM public.explore_events WHERE id = v_eid) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a women-only community''s Live event is not readable by a matching woman';
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);

  DELETE FROM public.explore_events WHERE id = v_eid;
  DELETE FROM public.communities WHERE id = v_cid;

  RAISE NOTICE 'gender-restricted-communities Scene-tab visibility self-test passed';
END $$;

COMMIT;
