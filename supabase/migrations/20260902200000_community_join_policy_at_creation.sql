-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- Explicit join-policy choice at community creation, 2026-09-02.
--
-- Real gap this closes: `communities.join_policy` already exists live in
-- production (created out-of-band, no migration ever captured it -- same
-- pattern as the other never-migrated objects found this session) and
-- `request_to_join_community()` (20260706150000_mvp_batch.sql) already reads
-- it to decide open-vs-pending. But `create_community()` never writes it, so
-- every community today silently gets whatever the column's bare default is
-- -- confirmed live 2026-09-02: 5 of 5 existing communities are 'open', with
-- zero explicit creator choice ever made. Josh's call 2026-09-02: grandfather
-- those 5 exactly as they are (no backfill/flip here), and build the real
-- creator-facing choice going forward. This migration is that choice, at the
-- one place it belongs -- creation time, alongside the same-shaped
-- restricted_gender choice from 20260901080000, which is "set once, not
-- editable after" for the identical reason (a leader flip-flopping the door
-- after people have already joined under one rule is a support problem, not
-- a feature).
--
-- Deliberately NOT built here: `set_community_join_policy()` (the RPC
-- lib/creatorMode.ts's setJoinPolicy() already calls, and the already-built
-- app/creator/join-gate.tsx toggle already renders behind JOIN_GATE_ENABLED)
-- for editing policy AFTER creation. Found on review: a review-only proposal
-- for exactly this already exists and is already contract-tested --
-- docs/database/review-only/community-join-policy-existing-text.sql, guarded
-- by a BEFORE UPDATE trigger (current_user must match the setter function's
-- owner) rather than a column-level GRANT restructure -- smarter than the
-- grant-surgery approach creatorMode.ts's own comment describes, and it
-- sidesteps needing to enumerate every other live communities column. That
-- file is still REVIEW ONLY / DO NOT APPLY, is Josh's separate decision, and
-- is not touched or duplicated here. This migration's CHECK constraint
-- reuses that file's exact name and NOT VALID/VALIDATE two-step (a real
-- production-safety pattern for a live, heavily-read table: NOT VALID skips
-- the full-table lock a plain ADD CONSTRAINT would take) so applying both,
-- in either order, adds the rule once, not twice.
--
-- Layers on top of (already live on prod):
--   20260702184012_communities_skeleton.sql          (communities, community_members)
--   20260819000000_community_city.sql +
--   20260820030000_community_purpose_name_length.sql (create_community's live 5-arg signature,
--                                                      reproduced verbatim below plus one param)
--   20260706150000_mvp_batch.sql                     (request_to_join_community, the real reader
--                                                      of join_policy)
--
-- Sequencing note for whoever applies migrations next: 20260901080000
-- (gender-restricted communities, also unapplied) independently adds a 6th
-- param (p_restricted_gender) to this SAME function, also layered on the
-- live 5-arg signature. Whichever of these two applies SECOND must merge
-- both new params into one final 7-arg create_community rather than
-- clobbering the other's addition -- same rule this repo's migrations
-- already follow for signature changes (see 20260901080000's own header).
--
-- VERIFIED 2026-09-02 via a real rollback-wrapped dry run against production
-- (Supabase CLI, `supabase db query --linked --file`, this file's own COMMIT
-- swapped for ROLLBACK): the self-test below ran end to end against real
-- operator_grants data with zero exceptions, then rolled back with zero rows
-- left behind (confirmed separately by count). Still marked DRAFT: DO NOT
-- APPLY WITHOUT JOSH WORD below -- a clean dry run is proof it's SAFE to
-- apply, not authorization to apply it.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.communities') IS NULL THEN
    RAISE EXCEPTION 'join-policy-at-creation dependency missing: public.communities';
  END IF;
  IF to_regprocedure('public.create_community(text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'join-policy-at-creation dependency missing: public.create_community(text,text,text,text,text) (20260819000000 + 20260820030000)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. communities.join_policy. IF NOT EXISTS because this column is already
--    live in production out-of-band (confirmed: request_to_join_community
--    already reads it) -- this statement is a no-op there, and only matters
--    for a fresh/local database that has never seen the out-of-band column.
--    No CHECK constraint exists on it today; adding one now, scoped to the
--    two values any real code path can produce (invite_only has no build
--    behind it yet per lib/creatorMode.ts's own JoinPolicy comment -- "do not
--    build a UI path that cannot actually work yet" -- so it is deliberately
--    excluded here too, same restraint).
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS join_policy text DEFAULT 'open';

UPDATE public.communities SET join_policy = 'open' WHERE join_policy IS NULL;

ALTER TABLE public.communities
  ALTER COLUMN join_policy SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.communities'::regclass
      AND conname = 'communities_join_policy_allowed_check'
  ) THEN
    ALTER TABLE public.communities
      ADD CONSTRAINT communities_join_policy_allowed_check
      CHECK (join_policy IN ('open', 'approval_required')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.communities
  VALIDATE CONSTRAINT communities_join_policy_allowed_check;

COMMENT ON COLUMN public.communities.join_policy IS
  'Who gets in: open (instant) or approval_required (leader reviews each request). Set explicitly at creation by create_community''s p_join_policy (2026-09-02) -- every prior row defaults to open (Josh 2026-09-02: grandfather the 5 pre-existing communities as-is, do not flip them). Read by request_to_join_community() (the real join door). Editable after creation only via set_community_join_policy(), which does not exist yet -- until it does, this value is create-time-only in practice, same as restricted_gender.';

-- ---------------------------------------------------------------------------
-- 2. create_community(): 6th optional param, DEFAULT 'open' so an unaware or
--    stale caller (including today's live client, until it ships this
--    change) gets byte-identical behavior to before this migration -- every
--    existing community is already 'open', so the default preserves that
--    exactly. Body reproduced verbatim from the live 5-arg definition
--    (20260820030000) plus the one validated column write.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_community(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_community(
  p_handle text,
  p_name text,
  p_description text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_join_policy text DEFAULT 'open'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_operator_grant(v_uid, 'community_leader') THEN
    RAISE EXCEPTION 'Community Leader grant required';
  END IF;
  IF p_join_policy NOT IN ('open', 'approval_required') THEN
    RAISE EXCEPTION 'join_policy must be open or approval_required';
  END IF;

  INSERT INTO communities (handle, name, description, city, purpose, join_policy, created_by)
  VALUES (p_handle, p_name, p_description, p_city, p_purpose, p_join_policy, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO community_members (community_id, user_id, role, status, joined_at)
  VALUES (v_id, v_uid, 'leader', 'active', now());

  INSERT INTO community_blocks (community_id, block_type, position) VALUES
    (v_id, 'cover', 0),
    (v_id, 'header', 1),
    (v_id, 'about', 2),
    (v_id, 'events_auto', 3),
    (v_id, 'members_auto', 4);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community(text, text, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.create_community(text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_community(text, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Self-test. Real INSERT/DELETE against real rows, cleaned up before
--    commit, simulated auth via transaction-local jwt claims -- same style as
--    the skeleton and C-04 migrations.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_leader uuid;
  v_cid_default uuid;
  v_cid_explicit uuid;
  v_raised boolean;
  v_policy text;
BEGIN
  SELECT user_id INTO v_leader FROM public.operator_grants
    WHERE track = 'community_leader' AND status = 'approved' LIMIT 1;
  IF v_leader IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs an existing approved community_leader grant to test with';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- omitting p_join_policy entirely defaults to 'open' (backward compatible
  -- with every caller that predates this migration)
  v_cid_default := public.create_community(
    'selftest-joinpolicy-default-' || substr(v_leader::text, 1, 8),
    'selftest join policy default', NULL, NULL, NULL
  );
  SELECT join_policy INTO v_policy FROM public.communities WHERE id = v_cid_default;
  IF v_policy IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: omitting p_join_policy did not default to open (got %)', v_policy;
  END IF;

  -- an explicit approval_required choice persists exactly
  v_cid_explicit := public.create_community(
    'selftest-joinpolicy-explicit-' || substr(v_leader::text, 1, 8),
    'selftest join policy explicit', NULL, NULL, NULL, 'approval_required'
  );
  SELECT join_policy INTO v_policy FROM public.communities WHERE id = v_cid_explicit;
  IF v_policy IS DISTINCT FROM 'approval_required' THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: explicit approval_required did not persist (got %)', v_policy;
  END IF;

  -- an invalid value is rejected, not silently coerced or stored
  v_raised := false;
  BEGIN
    PERFORM public.create_community(
      'selftest-joinpolicy-bad-' || substr(v_leader::text, 1, 8),
      'selftest join policy bad', NULL, NULL, NULL, 'invite_only'
    );
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: an unsupported join_policy value (invite_only) was accepted';
  END IF;

  -- the CHECK constraint itself rejects a direct write of a bogus value,
  -- independent of the RPC's own validation (defense in depth, same
  -- precedent as every other constrained column in this repo)
  RESET ROLE;
  v_raised := false;
  BEGIN
    UPDATE public.communities SET join_policy = 'bogus' WHERE id = v_cid_default;
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: communities_join_policy_check did not reject a bogus value';
  END IF;

  -- cleanup at full privilege (impersonated-role deletes silently no-op
  -- against community_members RLS -- same caught-live precedent as the C-04
  -- migration's own cleanup comment)
  PERFORM set_config('request.jwt.claims', NULL, true);
  DELETE FROM public.community_members WHERE community_id IN (v_cid_default, v_cid_explicit);
  DELETE FROM public.community_blocks WHERE community_id IN (v_cid_default, v_cid_explicit);
  DELETE FROM public.communities WHERE id IN (v_cid_default, v_cid_explicit);

  RAISE NOTICE 'join-policy-at-creation self-test passed';
END;
$$;

COMMIT;
