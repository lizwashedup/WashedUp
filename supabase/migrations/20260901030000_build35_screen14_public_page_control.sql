-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- Build 35 Screen 14: Community public page control center.
-- Written for
-- clients/washed-up/specs/washedup-BUILD35-SCREEN14-PUBLIC-PAGE-CONTROL-CENTER-20260901.md.
--
-- SCOPE: adds the one backend field the new control-center screen's
-- discovery toggle needs -- communities.discoverable -- and wires it into
-- the one function that actually IS "general browse/search"
-- (get_discoverable_communities(), 20260706150000_mvp_batch.sql), so the
-- toggle has a real effect instead of being cosmetic. Nothing else needs a
-- schema change: status (the existing communities.status enum) and the
-- shareable link (the existing communities.handle) already exist; unpublish
-- is an application-layer write (status active -> draft) through the same
-- plain leader-scoped update publishCommunity() already uses in reverse.
--
-- ADDITIVE ONLY. NOT applied anywhere -- same convention as
-- 20260819000000_community_city.sql: sits in the repo until Josh applies it.
-- `default true` means every existing community keeps appearing in
-- discovery exactly as it does today; nothing changes for anyone until a
-- leader actively opts out through the new screen.
--
-- WHY NO NEW RPC: unlike join_policy (proposal 91, not built yet -- see
-- lib/creatorMode.ts's getJoinPolicy header), flipping discoverable carries
-- no side effect worth guarding -- nothing else reads or reacts to it. A
-- leader flipping their own community's discoverable bit is the same shape
-- as publishCommunity() and updateJoinGateSettings(), both plain updates
-- through the existing leader-scoped communities_update RLS policy.
-- setCommunityDiscoverable() (lib/creatorMode.ts) is a plain
-- supabase.from('communities').update(...), not an RPC, and checks
-- {count:'exact'} the same way updateJoinGateSettings() does so a
-- non-leader's write cannot silently report success while changing zero
-- rows.
--
-- SELF-FLIPPING, same mechanism as getJoinPolicy/JOIN_GATE_ENABLED: the
-- client reads this column defensively (42703 undefined_column -> null), so
-- the toggle stays hidden on any build running against a database where
-- this migration has not landed yet, and wakes automatically the moment it
-- has. Also gated behind PUBLIC_PAGE_CONTROL_ENABLED
-- (constants/FeatureFlags.ts, default off) at the screen level -- the same
-- double-gate shape the join-gate toggle uses, so neither the flag nor this
-- migration alone can expose a dead control.
--
-- discoverable is independent of status: an unpublished (draft/archived)
-- community is already excluded from the discovery rail via status alone.
-- discoverable is a narrower opt-out available only on TOP of published,
-- never a substitute for it and never a second publish switch.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.communities') IS NULL THEN
    RAISE EXCEPTION 'screen 14 dependency missing: communities skeleton (20260702184012) not present';
  END IF;
  IF to_regprocedure('public.get_discoverable_communities()') IS NULL THEN
    RAISE EXCEPTION 'screen 14 dependency missing: public.get_discoverable_communities() (20260706150000)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. column
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.communities.discoverable IS
  'Build 35 Screen 14. Whether a published community appears in general browse/search (get_discoverable_communities()). Independent of status: an unpublished (draft/archived) community is already excluded via status regardless of this flag, and this flag never makes an unpublished community appear. Defaults true so every existing community keeps appearing exactly as it does today; a leader opts OUT through the new public-page control-center screen, never opts in from a hidden-by-default state.';

-- ---------------------------------------------------------------------------
-- 2. re-wire the one real discovery surface to respect it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_discoverable_communities()
RETURNS TABLE (
  id uuid,
  handle text,
  name text,
  description text,
  accent_color text,
  cover_image text,
  member_count integer,
  next_event_title text,
  next_event_date date
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id, c.handle, c.name, c.description, c.accent_color,
    (SELECT b.content->'images'->>0
     FROM community_blocks b
     WHERE b.community_id = c.id AND b.block_type = 'cover' AND b.visible
     ORDER BY b.position LIMIT 1) AS cover_image,
    (SELECT count(*)::integer FROM community_members m
     WHERE m.community_id = c.id AND m.status = 'active') AS member_count,
    ne.title AS next_event_title,
    ne.event_date AS next_event_date
  FROM communities c
  LEFT JOIN LATERAL (
    SELECT e.title, e.event_date
    FROM explore_events e
    WHERE e.community_id = c.id AND e.status = 'Live'
      AND coalesce(e.event_date, current_date) >= current_date
    ORDER BY e.event_date ASC NULLS LAST
    LIMIT 1
  ) ne ON true
  WHERE c.status = 'active'
    AND c.discoverable
  ORDER BY member_count DESC, c.created_at ASC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_discoverable_communities() FROM public;
GRANT EXECUTE ON FUNCTION public.get_discoverable_communities() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. self-test
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'communities' AND column_name = 'discoverable'
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: communities.discoverable missing';
  END IF;
END;
$$;

-- behavioral self-test: an opted-out community must not appear in the
-- discovery rail even while published; an opted-in one must. Needs no real
-- auth.users row (created_by is nullable, same as the skeleton migration's
-- own self-test), cleans up before commit.
DO $$
DECLARE
  v_visible_id uuid;
  v_hidden_id uuid;
BEGIN
  INSERT INTO public.communities (handle, name, status, discoverable)
  VALUES ('selftest-s14-visible-tmp', 'self test visible', 'active', true)
  RETURNING id INTO v_visible_id;
  INSERT INTO public.communities (handle, name, status, discoverable)
  VALUES ('selftest-s14-hidden-tmp', 'self test hidden', 'active', false)
  RETURNING id INTO v_hidden_id;

  IF NOT EXISTS (SELECT 1 FROM public.get_discoverable_communities() d WHERE d.id = v_visible_id) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: discoverable=true community did not appear in the discovery rail';
  END IF;
  IF EXISTS (SELECT 1 FROM public.get_discoverable_communities() d WHERE d.id = v_hidden_id) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: discoverable=false community leaked into the discovery rail';
  END IF;

  DELETE FROM public.communities WHERE id IN (v_visible_id, v_hidden_id);
  RAISE NOTICE 'screen 14 discoverable self-test passed';
END;
$$;

COMMIT;
