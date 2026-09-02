-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
-- ============================================================================
-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD.
--
-- Build 35 Screen 56: Community member invitations. Written for
-- clients/washed-up/specs/washedup-BUILD35-SCREEN56-MEMBER-INVITATIONS-20260901.md,
-- which found every primitive this needs already exists (searchProfilesForInvite(),
-- the community_creator_invites bound-token pattern) except the invite record
-- itself, and one locked invariant to build against (see below).
--
-- SCOPE. An existing member/leader of a community picks an existing WashedUp
-- profile (search only -- see V1 SCOPE below) and sends them a bound,
-- single-use, expiring invite to join as a plain member. Acceptance grants
-- community_members role='member' directly, the same "accept activates
-- immediately, no separate review step" shape community_creator_invites
-- already uses for a HIGHER-privilege grant (co-creator/admin access) --
-- see DELIBERATE CALL 3 below.
--
-- This is a NEW, INDEPENDENT table from community_creator_invites
-- (20260817180000), not a widening of it -- the scope doc is explicit that
-- status tracking (Invited/Joined/Expired) must not collide with team
-- invites, and the two invite types must stay visibly and functionally
-- separate (members.tsx already has a team-invite entry point; this
-- migration's application code adds a second, distinct one, never reusing
-- the first).
--
-- V1 SCOPE, deliberately narrower than community_creator_invites: this table
-- has no target_email / target_phone columns and no role column.
--   * The PDF's second invite path ("optionally phone contacts", i.e. an
--     on-device Contacts picker) is an explicit OPEN PRODUCT DECISION per the
--     scope doc §4, not an engineering default -- this migration does not
--     build it, and there is no expo-contacts/react-native-contacts
--     dependency anywhere in this repo to build it against yet. Add
--     target_phone (and the Contacts-permission UI) as a follow-up migration
--     if/when Liz or Josh says v1 should include it -- do not widen this
--     table speculatively now.
--   * role is not stored because there is only one outcome: acceptance always
--     grants plain 'member'. Unlike community_creator_invites (S-03's
--     admin/events/member_care/finance tiers), a member invite never grants
--     elevated access, so there is nothing to parametrize.
--
-- THE INVITE-DIRECTION INVARIANT (Liz, 2026-08-27, clients/washed-up/CLAUDE.md
-- "Referral invariant"): direction is inviter -> recipient, never the reverse.
-- That section's literal text is about the personal /r/<code> link and
-- people_connections (claim_referral_invite, 20260827210000) -- a DIFFERENT
-- object than community membership. This migration applies the same
-- PRINCIPLE to that different object, the same way community_creator_invites
-- already does and was never written to touch people_connections at all:
-- the pending row here is created by and belongs to the INVITER
-- (invited_by_user_id) the moment they send it; the recipient only ever
-- consumes/accepts a row that already exists, and never calls anything that
-- creates a request pointed back at the inviter. accept_member_invite() takes
-- no path that could be read as "the recipient asking the inviter" -- it
-- inserts the recipient directly into community_members once the binding
-- check (below) passes. Flagging this object-level distinction explicitly
-- per the build brief rather than silently asserting the two are the same
-- mechanism.
--
-- THE BINDING GUARANTEE (mirrors community_creator_invites' own header note
-- and self-test): knowing a valid, unexpired, unused token is necessary but
-- never sufficient to accept. accept_member_invite() re-derives the caller's
-- identity from auth.uid() alone and refuses unless it equals the invite's
-- target_user_id. A forwarded or leaked link changes who HOLDS the token,
-- never who it is FOR. See lib/memberInvites.ts decideMemberInviteBindingOutcome(),
-- the pure, DB-independent re-expression of this same predicate, unit-tested
-- in lib/__tests__/memberInvites.test.ts since this sandbox has no live
-- Postgres to run the self-test below against. Keep the two in lockstep.
--
-- DELIBERATE CALLS, flagged for review (Josh/Liz, not defaulted silently):
--   1. WHO CAN SEND ONE: is_community_leader(community_id, uid) -- active
--      leader OR co_leader, not primary-leader-only. This is DELIBERATELY
--      BROADER than create_co_creator_invite()'s primary-leader-only gate.
--      Reasoning: granting co-creator/admin access is high-stakes and stays
--      leader-only by that migration's own design; inviting a plain member is
--      the same privilege level a leader/co_leader can already grant by hand
--      (reviewJoinRequest() approving a pending join request is already
--      leader+co_leader-scoped via canManageMembers/is_community_leader on
--      the client, and community_members.role today only ever actually holds
--      'leader'/'co_leader'/'member' in production -- the four S-03 tiers
--      exist only in lib/creatorMode.ts, see 20260901000000's header note),
--      so gating invite-sending any narrower would be inconsistent with what
--      a co_leader can already do through the existing approve/decline path.
--      Easy one-line tightening to leader-only later if Liz wants it stricter.
--   2. ALREADY-A-MEMBER GUARD: refuses inviting anyone who already holds an
--      'active' OR 'pending' community_members row for this community (they
--      are already in, or already in the join-request queue -- inviting them
--      again is not a meaningful action). Banned targets are refused
--      outright with their own explicit error, mirroring
--      create_co_creator_invite()'s explicit banned check ahead of the
--      ON CONFLICT ... WHERE status <> 'banned' upsert, for the same reason:
--      never let an upsert silently no-op a grant.
--   3. ACCEPT ACTIVATES IMMEDIATELY, no separate join-request review step:
--      accept_member_invite() upserts community_members straight to
--      status='active', the same shape accept_co_creator_invite() already
--      uses for co_leader. This bypasses the "wants in" review queue
--      members.tsx shows for unsolicited join requests -- deliberately: the
--      person sending the invite is, by DELIBERATE CALL 1 above, already
--      someone who could unilaterally approve a pending join request through
--      that exact queue, so requiring a second self-approval for a lower-
--      privilege grant (plain member vs. co-creator) than the ungated
--      co-creator precedent would be pure friction, not a real safeguard.
--      This is a real product call, restated here rather than buried in code
--      only, in case Liz wants invited members to still land 'pending'.
--   4. REVOKE COVERS 'viewed', not just 'pending' -- community_creator_invites'
--      own revoke_co_creator_invite() only flips status from 'pending',
--      which means a co-creator invite that has been opened (status='viewed')
--      cannot actually be revoked through that RPC today. Both the unique
--      partial index and the resend-supersede step treat pending+viewed as
--      one "outstanding" bucket everywhere else in that file, so the
--      pending-only revoke guard reads as an oversight, not a deliberate
--      choice. This migration's revoke_member_invite() covers both
--      ('pending', 'viewed') on purpose -- a correction made here, not
--      silently carried forward, and not applied to the existing table.
--
-- House rules honored, same as 20260817180000 and 20260901000000: RLS on
-- with the same visibility shape (inviter, target, is_community_leader,
-- admin), no client-facing INSERT/UPDATE policy (mutation is RPC-only),
-- token stored only as md5(token) (never plaintext -- same rationale as
-- community_creator_invites: the property is "a DB dump does not hand out
-- live bearer tokens", entropy comes from two concatenated gen_random_uuid()s,
-- not from the hash), reuses update_updated_at_column(), in-transaction
-- self-test via the SELFTEST_ROLLBACK savepoint pattern so it leaves zero
-- trace -- never strip it on apply.
--
-- NOT done here, flagged for the follow-up this migration's brief called for:
-- this file is not registered in scripts/db-contracts/migration-contracts.json
-- (approved_untracked_migrations / inventory hash) -- that bookkeeping needs
-- the same treatment already pending for 20260901000000 and 20260901010000,
-- deliberately left for a follow-up rather than hand-edited here.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.communities') IS NULL
     OR to_regclass('public.community_members') IS NULL THEN
    RAISE EXCEPTION 'member invite dependency missing: communities skeleton (20260702184012) not present';
  END IF;
  IF to_regprocedure('public.is_community_leader(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'member invite dependency missing: public.is_community_leader(uuid,uuid)';
  END IF;
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'member invite dependency missing: public.update_updated_at_column()';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. enum + table
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'community_member_invite_status') THEN
    CREATE TYPE public.community_member_invite_status AS ENUM
      ('pending', 'viewed', 'accepted', 'revoked', 'expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.community_member_invites (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id         uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  -- cascades with the inviter, same reasoning as community_creator_invites:
  -- an unaccepted invite from a deleted account has no one left to vouch for it.
  invited_by_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- V1 SCOPE: always known at creation (existing-profile path only). No
  -- target_email / target_phone columns -- see header note.
  target_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_message       text CHECK (invite_message IS NULL OR char_length(invite_message) <= 300),
  status               public.community_member_invite_status NOT NULL DEFAULT 'pending',
  token_hash           text NOT NULL UNIQUE,
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  accepted_at          timestamptz,
  accepted_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at           timestamptz,
  revoked_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (target_user_id <> invited_by_user_id)
);

-- one outstanding invite per target per community, scoped to ('pending',
-- 'viewed') same as community_creator_invites -- opening the preview still
-- counts as outstanding.
CREATE UNIQUE INDEX IF NOT EXISTS community_member_invites_pending_target_idx
  ON public.community_member_invites (community_id, target_user_id)
  WHERE status IN ('pending', 'viewed');

CREATE INDEX IF NOT EXISTS community_member_invites_community_idx
  ON public.community_member_invites (community_id, status);
CREATE INDEX IF NOT EXISTS community_member_invites_inviter_idx
  ON public.community_member_invites (invited_by_user_id);

CREATE TRIGGER update_community_member_invites_updated_at
  BEFORE UPDATE ON public.community_member_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- identity is immutable, including target_user_id -- unlike
-- community_creator_invites, this table has no email/phone path where
-- target_user_id legitimately starts NULL and fills in later, so it can be
-- guarded as immutable from creation.
CREATE OR REPLACE FUNCTION public.community_member_invites_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF new.community_id <> old.community_id
     OR new.token_hash <> old.token_hash
     OR new.id <> old.id
     OR new.target_user_id <> old.target_user_id THEN
    RAISE EXCEPTION 'member invite identity cannot be changed';
  END IF;
  RETURN new;
END;
$$;

CREATE TRIGGER community_member_invites_identity_guard
  BEFORE UPDATE ON public.community_member_invites
  FOR EACH ROW EXECUTE FUNCTION public.community_member_invites_identity_immutable();

COMMENT ON TABLE public.community_member_invites IS
  'Build 35 Screen 56. Bound, single-use, expiring invites that grant plain community_members role=member on acceptance. Distinct from community_creator_invites (co-creator/admin grants) so status tracking never collides. All mutation goes through create_/accept_/revoke_member_invite(); there is no client-facing INSERT or UPDATE policy. V1 scope: existing-profile targets only, see migration header for the deferred phone-contact path.';
COMMENT ON COLUMN public.community_member_invites.token_hash IS
  'md5(raw token). The raw token is returned once from create_member_invite() and never stored.';

-- ---------------------------------------------------------------------------
-- 2. RPCs
-- ---------------------------------------------------------------------------

-- Any active leader/co_leader of the community (or admin) -- see DELIBERATE
-- CALL 1. Returns the raw token ONCE; the caller builds and shares the
-- invite link (client-side, mirrors create_co_creator_invite()) -- this
-- function does not send anything.
CREATE OR REPLACE FUNCTION public.create_member_invite(
  p_community_id   uuid,
  p_target_user_id uuid,
  p_message        text DEFAULT NULL
)
RETURNS TABLE(invite_id uuid, raw_token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_message text := btrim(p_message);
  v_token   text;
  v_id      uuid;
  v_expires timestamptz := now() + interval '72 hours';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_message = '' THEN v_message := NULL; END IF;
  IF v_message IS NOT NULL AND char_length(v_message) > 300 THEN
    RAISE EXCEPTION 'message is too long' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'a target profile is required' USING ERRCODE = '22023';
  END IF;
  IF p_target_user_id = v_uid THEN
    RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
  END IF;

  -- DELIBERATE CALL 1: leader OR co_leader, not primary-leader-only.
  IF NOT public.is_community_leader(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'community leader or co-leader required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = p_community_id AND c.status <> 'archived') THEN
    RAISE EXCEPTION 'community not found or archived' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_target_user_id) THEN
    RAISE EXCEPTION 'that profile does not exist' USING ERRCODE = '22023';
  END IF;

  -- DELIBERATE CALL 2: banned refused outright, never silently no-op'd.
  IF EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = p_community_id AND cm.user_id = p_target_user_id AND cm.status = 'banned'
  ) THEN
    RAISE EXCEPTION 'cannot invite: banned from this community' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = p_community_id AND cm.user_id = p_target_user_id
      AND cm.status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'already a member or has a pending join request' USING ERRCODE = '22023';
  END IF;

  -- resend supersedes rather than hard-failing on the partial unique index --
  -- same pattern as create_co_creator_invite(). Old token stops working
  -- immediately (status flips to revoked).
  UPDATE public.community_member_invites
  SET status = 'revoked', revoked_at = now(), revoked_by_user_id = v_uid
  WHERE community_id = p_community_id
    AND target_user_id = p_target_user_id
    AND status IN ('pending', 'viewed');

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.community_member_invites
    (community_id, invited_by_user_id, target_user_id, invite_message, token_hash, expires_at)
  VALUES
    (p_community_id, v_uid, p_target_user_id, v_message, md5(v_token), v_expires)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_expires;
END;
$$;

-- Read-only, anon-callable: an unauthenticated deep-link open can show "you're
-- invited to join {community}" before signup. Never grants or checks binding
-- -- that only happens in accept_member_invite(). Looking a token up here
-- does not consume it, but does advance pending -> viewed (the only "viewed"
-- signal this feature has, mirrors preview_co_creator_invite()).
CREATE OR REPLACE FUNCTION public.preview_member_invite(p_token text)
RETURNS TABLE(
  invite_id       uuid,
  community_id    uuid,
  community_name  text,
  community_handle text,
  invited_by_name text,
  status          public.community_member_invite_status,
  expires_at      timestamptz,
  invite_message  text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite record;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN;
  END IF;

  SELECT i.*, c.name AS c_name, c.handle AS c_handle,
         coalesce(p.first_name_display, 'Someone') AS inviter_name
  INTO v_invite
  FROM public.community_member_invites i
  JOIN public.communities c ON c.id = i.community_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by_user_id
  WHERE i.token_hash = md5(p_token);

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_invite.status = 'pending' AND v_invite.expires_at > now() THEN
    UPDATE public.community_member_invites SET status = 'viewed' WHERE id = v_invite.id;
    v_invite.status := 'viewed';
  END IF;

  RETURN QUERY SELECT
    v_invite.id,
    v_invite.community_id,
    v_invite.c_name,
    v_invite.c_handle,
    v_invite.inviter_name,
    CASE WHEN v_invite.status IN ('pending', 'viewed') AND v_invite.expires_at <= now() THEN 'expired'::public.community_member_invite_status
         ELSE v_invite.status END,
    v_invite.expires_at,
    v_invite.invite_message;
END;
$$;

-- THE BINDING ENFORCEMENT POINT. Identity is NEVER taken from p_token /
-- p_invite_id, only from auth.uid(). See header note.
CREATE OR REPLACE FUNCTION public.accept_member_invite(
  p_token     text DEFAULT NULL,
  p_invite_id uuid DEFAULT NULL
)
RETURNS TABLE(community_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_invite public.community_member_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF (p_token IS NULL OR btrim(p_token) = '') AND p_invite_id IS NULL THEN
    RAISE EXCEPTION 'a token or invite id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invite
  FROM public.community_member_invites
  WHERE (p_token IS NOT NULL AND token_hash = md5(p_token))
     OR (p_invite_id IS NOT NULL AND id = p_invite_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found' USING ERRCODE = '22023';
  END IF;

  IF v_invite.status IN ('pending', 'viewed') AND v_invite.expires_at <= now() THEN
    UPDATE public.community_member_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'this invite has expired' USING ERRCODE = '22023';
  END IF;
  IF v_invite.status NOT IN ('pending', 'viewed') THEN
    RAISE EXCEPTION 'this invite is no longer available' USING ERRCODE = '22023';
  END IF;

  -- === binding check: the caller's OWN identity only, never the token ===
  IF v_invite.target_user_id <> v_uid THEN
    RAISE EXCEPTION 'this invite is not for you' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = v_invite.community_id AND cm.user_id = v_uid AND cm.status = 'banned'
  ) THEN
    RAISE EXCEPTION 'cannot accept: banned from this community' USING ERRCODE = '42501';
  END IF;

  -- DELIBERATE CALL 3: activates immediately, no separate review step.
  INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
  VALUES (v_invite.community_id, v_uid, 'member', 'active', now())
  ON CONFLICT (community_id, user_id) DO UPDATE
    SET status = 'active',
        joined_at = coalesce(public.community_members.joined_at, now())
    WHERE public.community_members.status <> 'banned';

  UPDATE public.community_member_invites
  SET status = 'accepted', accepted_at = now(), accepted_by_user_id = v_uid
  WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.community_id;
END;
$$;

-- Inviter, any active leader/co_leader of the community, or admin. Covers
-- 'viewed' as well as 'pending' -- see DELIBERATE CALL 4.
CREATE OR REPLACE FUNCTION public.revoke_member_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_invite public.community_member_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite FROM public.community_member_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN; -- idempotent: already gone
  END IF;

  IF v_invite.invited_by_user_id <> v_uid
     AND NOT public.is_community_leader(v_invite.community_id, v_uid) THEN
    RAISE EXCEPTION 'not authorized to revoke this invite' USING ERRCODE = '42501';
  END IF;

  IF v_invite.status IN ('pending', 'viewed') THEN
    UPDATE public.community_member_invites
    SET status = 'revoked', revoked_at = now(), revoked_by_user_id = v_uid
    WHERE id = p_invite_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_member_invite(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_member_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_member_invite(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_member_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_member_invite(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_member_invite(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.accept_member_invite(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_member_invite(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_member_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_member_invites_select ON public.community_member_invites
  FOR SELECT USING (
    invited_by_user_id = (select auth.uid())
    OR target_user_id = (select auth.uid())
    OR is_community_leader(community_id, (select auth.uid()))
    OR is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)
  );

-- No INSERT or UPDATE policy: creation, acceptance, and revocation all go
-- through the SECURITY DEFINER RPCs above.
CREATE POLICY community_member_invites_delete ON public.community_member_invites
  FOR DELETE USING (is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- 4. schema self-test
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.community_member_invites'::regclass) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: RLS not enabled on community_member_invites';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'community_member_invites') = 0 THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: no policies on community_member_invites';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'community_member_invites' AND cmd IN ('INSERT', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a client-facing INSERT/UPDATE policy exists (mutation must stay RPC-only)';
  END IF;
  RAISE NOTICE 'community_member_invites schema self-test passed';
END $$;

-- ---------------------------------------------------------------------------
-- 5. live-row self-test: the binding guarantee, expiry / revoke (incl.
--    viewed) / reuse / gating (incl. the leader-vs-co_leader distinction),
--    already-a-member guard, self-invite guard, resend-supersede, and
--    preview's viewed transition. Same three seeded fixture users as
--    20260817180000 (Liz/Sage/cafe0002), same SELFTEST_ROLLBACK savepoint
--    pattern so it leaves zero trace. Never strip on apply.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_leader   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';  -- Liz: leader
  v_sage     uuid := 'cafe0001-0000-0000-0000-000000000001';  -- Sage
  v_other    uuid := 'cafe0002-0000-0000-0000-000000000002';  -- the wrong person
  v_cid      uuid;
  v_invite1  uuid; v_token1 text;
  v_invite2  uuid; v_token2 text;
  v_invite3  uuid; v_token3 text;
  v_invite4  uuid; v_token4 text;
  v_invite6  uuid; v_token6 text;
  v_invite9  uuid; v_token9 text;
  v_invite10 uuid; v_token10 text;
  v_raised   boolean;
  v_cidret   uuid;
  v_status   public.community_member_invite_status;
  v_preview_status public.community_member_invite_status;
BEGIN
  IF v_leader IS NULL OR v_sage IS NULL OR v_other IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_leader)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_sage)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_other) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs the three seeded fixture users (Liz/Sage/cafe0002) to run';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    v_cid := public.create_community('selftest-memberinv-tmp', 'Self Test Member Invites');

    -- ============ CASE 1: happy path + single-use ==========================
    SELECT invite_id, raw_token INTO v_invite1, v_token1
    FROM public.create_member_invite(v_cid, v_sage, 'come hang out');

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
    SELECT community_id INTO v_cidret FROM public.accept_member_invite(p_invite_id => v_invite1);
    IF v_cidret IS DISTINCT FROM v_cid THEN
      RAISE EXCEPTION 'self-test C1: accept did not return the right community';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = v_cid AND user_id = v_sage AND role = 'member' AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'self-test C1: Sage does not hold an active member row';
    END IF;

    v_raised := false;
    BEGIN
      PERFORM public.accept_member_invite(p_invite_id => v_invite1);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C1: an already-accepted invite was accepted again';
    END IF;

    -- ============ CASE 2: THE FORWARDED-LINK TEST ===========================
    DELETE FROM public.community_members WHERE community_id = v_cid AND user_id = v_sage;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    SELECT invite_id, raw_token INTO v_invite2, v_token2
    FROM public.create_member_invite(v_cid, v_sage);

    -- the link leaks to "the wrong person" (cafe0002), a real authenticated
    -- session holding the CORRECT raw token.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.accept_member_invite(p_token => v_token2);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C2 FAIL: a forwarded link granted membership to the wrong person';
    END IF;
    IF EXISTS (SELECT 1 FROM public.community_members WHERE community_id = v_cid AND user_id = v_other) THEN
      RAISE EXCEPTION 'self-test C2 FAIL: the wrong person got a membership row from a forwarded link';
    END IF;
    SELECT status INTO v_status FROM public.community_member_invites WHERE id = v_invite2;
    IF v_status <> 'pending' THEN
      RAISE EXCEPTION 'self-test C2: the failed wrong-person attempt consumed the invite (status %)', v_status;
    END IF;

    -- the real target still redeems it fine
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
    PERFORM public.accept_member_invite(p_token => v_token2);
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members WHERE community_id = v_cid AND user_id = v_sage AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'self-test C2: the correct recipient could not redeem their own token after the leak attempt';
    END IF;

    -- ============ CASE 3: expiry =============================================
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    SELECT invite_id, raw_token INTO v_invite3, v_token3
    FROM public.create_member_invite(v_cid, v_other);
    UPDATE public.community_member_invites SET expires_at = now() - interval '1 minute' WHERE id = v_invite3;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.accept_member_invite(p_token => v_token3);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C3 FAIL: an expired invite was accepted';
    END IF;
    SELECT status INTO v_status FROM public.community_member_invites WHERE id = v_invite3;
    IF v_status <> 'expired' THEN
      RAISE EXCEPTION 'self-test C3: expired invite did not flip status (got %)', v_status;
    END IF;

    -- ============ CASE 4: revoke, including a VIEWED invite (DELIBERATE ====
    -- ============ CALL 4), then accept fails ================================
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    SELECT invite_id, raw_token INTO v_invite4, v_token4
    FROM public.create_member_invite(v_cid, v_other);

    PERFORM set_config('request.jwt.claims', NULL, true);
    PERFORM public.preview_member_invite(v_token4);
    SELECT status INTO v_status FROM public.community_member_invites WHERE id = v_invite4;
    IF v_status <> 'viewed' THEN
      RAISE EXCEPTION 'self-test C4: preview did not flip status to viewed (got %)', v_status;
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    PERFORM public.revoke_member_invite(v_invite4);
    SELECT status INTO v_status FROM public.community_member_invites WHERE id = v_invite4;
    IF v_status <> 'revoked' THEN
      RAISE EXCEPTION 'self-test C4 FAIL: revoke did not flip a VIEWED invite to revoked (got %)', v_status;
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.accept_member_invite(p_token => v_token4);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C4 FAIL: a revoked invite was accepted';
    END IF;

    -- ============ CASE 5: a plain member cannot send an invite ==============
    -- Sage is currently an active plain member (case 2).
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.create_member_invite(v_cid, v_other);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C5 FAIL: a plain member was able to create a member invite';
    END IF;

    -- ============ CASE 6+9: a co_leader (not just primary leader) CAN send =
    -- ============ one -- DELIBERATE CALL 1 -- and a resend supersedes it ===
    UPDATE public.community_members SET role = 'co_leader' WHERE community_id = v_cid AND user_id = v_sage;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
    SELECT invite_id, raw_token INTO v_invite6, v_token6
    FROM public.create_member_invite(v_cid, v_other);
    IF v_invite6 IS NULL THEN
      RAISE EXCEPTION 'self-test C6 FAIL: an active co_leader could not create a member invite';
    END IF;

    -- Liz (primary leader) invites the same still-outstanding target again --
    -- must supersede Sage's invite, not hard-fail on the unique index.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    SELECT invite_id, raw_token INTO v_invite9, v_token9
    FROM public.create_member_invite(v_cid, v_other);

    SELECT status INTO v_status FROM public.community_member_invites WHERE id = v_invite6;
    IF v_status <> 'revoked' THEN
      RAISE EXCEPTION 'self-test C9 FAIL: resend did not revoke the earlier outstanding invite (got %)', v_status;
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.accept_member_invite(p_token => v_token6);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C9 FAIL: a superseded (revoked) old token was still accepted';
    END IF;

    PERFORM public.accept_member_invite(p_token => v_token9);
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members WHERE community_id = v_cid AND user_id = v_other AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'self-test C9 FAIL: the new superseding invite could not be accepted';
    END IF;

    -- ============ CASE 7: cannot invite an existing active member ==========
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      -- Sage is currently an active co_leader (case 6).
      PERFORM public.create_member_invite(v_cid, v_sage);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C7 FAIL: invited someone who already holds an active membership row';
    END IF;

    -- ============ CASE 8: cannot invite yourself =============================
    v_raised := false;
    BEGIN
      PERFORM public.create_member_invite(v_cid, v_leader);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C8 FAIL: a leader was able to invite themselves';
    END IF;

    -- ============ CASE 10: preview marks viewed, and a viewed invite can ===
    -- ============ still be accepted =========================================
    DELETE FROM public.community_members WHERE community_id = v_cid AND user_id = v_other;
    SELECT invite_id, raw_token INTO v_invite10, v_token10
    FROM public.create_member_invite(v_cid, v_other, 'one more time');

    PERFORM set_config('request.jwt.claims', NULL, true);
    SELECT status INTO v_preview_status FROM public.preview_member_invite(v_token10);
    IF v_preview_status IS DISTINCT FROM 'viewed' THEN
      RAISE EXCEPTION 'self-test C10: preview did not report viewed (got %)', v_preview_status;
    END IF;
    -- a second preview open must not error or un-flip it
    PERFORM public.preview_member_invite(v_token10);

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    PERFORM public.accept_member_invite(p_token => v_token10);
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members WHERE community_id = v_cid AND user_id = v_other AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'self-test C10 FAIL: a viewed invite could not be accepted';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'community_member_invites binding self-test passed (10 cases: happy-path+single-use, forwarded-link, expiry, revoke-incl-viewed, member-cannot-invite, co_leader-can-invite, already-member-guard, self-invite-guard, resend-supersedes, preview-viewed-transition)';
END $$;

COMMIT;
