-- ============================================================================
-- REVIEW ONLY. Forward migration. Do not apply without explicit approval.
--
-- R21 (qa/requirements.json): "Co-creators and multiple admins" -- foundation
-- and test only (scopeClass yellow, releaseGate block_b). This migration is
-- the private foundation; activation/experience decisions remain gated per
-- the source classification rule and are NOT decided by this file.
--
-- Co-creator invite: the primary leader (Owner) of a community invites a
-- co-creator at a chosen tier (p_role, added by S-03
-- 20260821010000/20260821020000: admin/events/member_care/finance -- never
-- leader or member), who lands with that role on community_members on
-- acceptance. Originally this table only ever granted 'co_leader'; the CHECK
-- constraint below and every hardcoded literal were widened for S-03 without
-- otherwise touching this file's structure. 'co_leader' remains a valid,
-- permanent role (S-03's Admin tier synonym); nothing here migrates old rows.
--
-- Two invite shapes, one table, one acceptance path:
--   * existing profile  -> target_user_id set at creation. RLS lets that user
--     see their own pending invite directly (mirrors plan_invites'
--     recipient_id pattern); no token needed to discover it, though one still
--     exists so the leader can also share it as a link.
--   * email/phone, no account yet -> target_user_id starts NULL. The invite is
--     discoverable only via its token (preview_co_creator_invite, anon-callable,
--     masked contact hint). It cannot activate anything by itself: acceptance
--     requires the redeemer to be signed in AND to hold a Supabase-CONFIRMED
--     email or phone that matches the invite's target exactly (auth.users
--     .email_confirmed_at / .phone_confirmed_at -- the same server-truthed
--     signal needs_phone_migration() already relies on, never a client claim).
--     "Create an account before access activates" falls out of this for free:
--     there is no account, there is no confirmed contact to match, there is no
--     path to acceptance.
--
-- THE BINDING GUARANTEE (this is what the task's self-test proves): knowing a
-- valid, unexpired, unused token is necessary but never sufficient to accept.
-- accept_co_creator_invite() re-derives the caller's identity from auth.uid()
-- and auth.users server-side on every call and refuses unless it matches the
-- invite's target. A forwarded or leaked link changes who HOLDS the token,
-- never who the invite is FOR. Mirrors lib/coCreatorInvites.ts
-- decideInviteBindingOutcome(), which is the same predicate re-expressed as a
-- pure, DB-independent function so it can be unit-tested without a live
-- Postgres. Keep the two in lockstep if either changes.
--
-- House rules honored: RLS on the new table, (select auth.uid()) initplan
-- wrapping is unnecessary here (no client-facing table policy re-runs
-- auth.uid() per row against a large scan -- the table is invite-row-scoped
-- already), admin override matches the existing is_admin()/has_role()
-- pattern, reuses update_updated_at_column(), all mutation goes through
-- SECURITY DEFINER RPCs (no INSERT/UPDATE policy at all, matching
-- create_community()'s "no INSERT policy for users" precedent), in-transaction
-- self-test at the bottom via the SELFTEST_ROLLBACK savepoint pattern
-- (add_or_accept_person.sql) so it leaves zero trace -- never strip it on
-- apply.
--
-- Deliberate calls, flagged for review:
--   * Only the PRIMARY leader (role = 'leader') can create a co-creator
--     invite, not an existing co_leader. "A primary community creator needs
--     to invite co-creators" (spec) reads as leader-only; loosening to let
--     co_leaders also invite is a one-line RLS-equivalent change to the RPC's
--     guard, no schema change, exactly like the topics leaders-only precedent
--     in communities_skeleton.sql.
--   * role is CHECKed to NOT IN ('leader', 'member'): a co-creator invite can
--     grant any tier except ownership (leader) or plain membership (member).
--     'leader' stays out on purpose -- this table is scoped to the co-creator
--     invite feature specifically, not a general leadership-transfer
--     mechanism; widening to 'leader' (ownership transfer) is a separate,
--     unbuilt concern. The NOT IN form (rather than an allowlist naming
--     'admin'/'events'/'member_care'/'finance' explicitly) is deliberate: it
--     only ever references the two labels that existed when this table was
--     first written, so it needs no edit when S-03
--     (20260821010000_community_role_tiers_enum.sql) later adds the four new
--     labels -- they are admitted automatically, this file does not need to
--     re-apply after that migration merges.
--   * Token is stored only as an md5 hash (token_hash), never in plaintext.
--     This is not password hashing -- the security property is "a full DB
--     dump does not hand out live bearer tokens", not collision resistance
--     against a targeted attacker; the token's own ~244 bits of gen_random_uuid
--     entropy is what actually resists guessing. pgcrypto/digest() is not
--     assumed available anywhere else in this codebase, so this uses only
--     core-Postgres gen_random_uuid()/md5(), no new extension dependency.
--   * A banned target is refused outright, never silently no-op'd: the
--     ON CONFLICT DO UPDATE ... WHERE status <> 'banned' clause on
--     community_members would otherwise let the invite mark itself
--     "accepted" while quietly granting no access. Checked explicitly before
--     the upsert (mirrors invite_to_circle's explicit
--     admin-required-to-restore-removed guard).
--   * Delivery (actually sending the SMS/email) is deliberately OUT of this
--     migration. The leader gets a shareable link + preview data back from
--     create_co_creator_invite() and sends it through their own channel (OS
--     share sheet, client-side). Wiring a transactional SMS/email send is a
--     separate integration decision (which provider, which copy) that this
--     foundation-and-test slice does not make.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.communities') IS NULL
     OR to_regclass('public.community_members') IS NULL THEN
    RAISE EXCEPTION 'co-creator invite dependency missing: communities skeleton (20260702184012) not present';
  END IF;
  IF to_regprocedure('public.is_community_leader(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'co-creator invite dependency missing: public.is_community_leader(uuid,uuid)';
  END IF;
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'co-creator invite dependency missing: public.update_updated_at_column()';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. enum + table
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'community_creator_invite_status') THEN
    CREATE TYPE public.community_creator_invite_status AS ENUM
      ('pending', 'viewed', 'accepted', 'revoked', 'expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.community_creator_invites (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id         uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  -- cascades with the inviter: an unaccepted invite from a deleted account has
  -- no one left to vouch for it and should not remain redeemable. Contrast
  -- with community_broadcasts.sender_id (SET NULL) -- that preserves a
  -- published message; this preserves nothing once pending.
  invited_by_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- known recipient at creation time (existing-profile path), or filled once
  -- on acceptance (email/phone path). Never the sole binding proof by itself
  -- once id-based lookup is in play -- see accept_co_creator_invite().
  target_user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  target_email         text,
  target_phone         text,
  role                 public.community_member_role NOT NULL DEFAULT 'co_leader'
                         CHECK (role NOT IN ('leader', 'member')),
  status               public.community_creator_invite_status NOT NULL DEFAULT 'pending',
  token_hash           text NOT NULL UNIQUE,
  expires_at           timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
  accepted_at          timestamptz,
  accepted_by_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at           timestamptz,
  revoked_by_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (target_user_id IS NOT NULL OR target_email IS NOT NULL OR target_phone IS NOT NULL),
  CHECK (target_email IS NULL OR target_email = lower(btrim(target_email)))
);

-- one outstanding invite per target per community, per target style. Scoped
-- to ('pending', 'viewed') rather than just 'pending' -- opening a preview
-- link still counts as outstanding, so it keeps holding this slot until it
-- is accepted, expires, or is superseded by a resend (see the supersede
-- step in create_co_creator_invite() below).
CREATE UNIQUE INDEX IF NOT EXISTS community_creator_invites_pending_user_idx
  ON public.community_creator_invites (community_id, target_user_id)
  WHERE status IN ('pending', 'viewed') AND target_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_creator_invites_pending_email_idx
  ON public.community_creator_invites (community_id, target_email)
  WHERE status IN ('pending', 'viewed') AND target_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_creator_invites_pending_phone_idx
  ON public.community_creator_invites (community_id, target_phone)
  WHERE status IN ('pending', 'viewed') AND target_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS community_creator_invites_community_idx
  ON public.community_creator_invites (community_id, status);
CREATE INDEX IF NOT EXISTS community_creator_invites_inviter_idx
  ON public.community_creator_invites (invited_by_user_id);

CREATE TRIGGER update_community_creator_invites_updated_at
  BEFORE UPDATE ON public.community_creator_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- community_id and the token identity never legitimately change after
-- creation (target_user_id does, on acceptance, so it is deliberately not
-- guarded here). Mirrors community_members_identity_immutable's guard,
-- scoped to what this table can never legitimately mutate.
CREATE OR REPLACE FUNCTION public.community_creator_invites_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF new.community_id <> old.community_id OR new.token_hash <> old.token_hash OR new.id <> old.id THEN
    RAISE EXCEPTION 'co-creator invite identity cannot be changed';
  END IF;
  RETURN new;
END;
$$;

CREATE TRIGGER community_creator_invites_identity_guard
  BEFORE UPDATE ON public.community_creator_invites
  FOR EACH ROW EXECUTE FUNCTION public.community_creator_invites_identity_immutable();

COMMENT ON TABLE public.community_creator_invites IS
  'Bound, single-use, expiring invites that grant the co_leader role on acceptance. All mutation goes through create_/accept_/revoke_co_creator_invite(); there is no client-facing INSERT or UPDATE policy.';
COMMENT ON COLUMN public.community_creator_invites.token_hash IS
  'md5(raw token). The raw token is returned once from create_co_creator_invite() and never stored.';

-- ---------------------------------------------------------------------------
-- 2. RPCs
-- ---------------------------------------------------------------------------

-- Primary-leader-only. Exactly one of (p_target_user_id) or
-- (p_target_email and/or p_target_phone) identifies the recipient. Returns
-- the raw token ONCE -- the caller is responsible for building and sharing
-- the invite link; this function does not send anything.
CREATE OR REPLACE FUNCTION public.create_co_creator_invite(
  p_community_id   uuid,
  p_target_user_id uuid DEFAULT NULL,
  p_target_email   text DEFAULT NULL,
  p_target_phone   text DEFAULT NULL,
  p_role           public.community_member_role DEFAULT 'admin'
)
RETURNS TABLE(invite_id uuid, raw_token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text := CASE WHEN p_target_email IS NOT NULL THEN lower(btrim(p_target_email)) END;
  v_phone   text := CASE WHEN p_target_phone IS NOT NULL THEN regexp_replace(p_target_phone, '[^0-9]', '', 'g') END;
  v_token   text;
  v_id      uuid;
  v_expires timestamptz := now() + interval '72 hours';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_email = '' THEN v_email := NULL; END IF;
  IF v_phone = '' THEN v_phone := NULL; END IF;

  IF p_target_user_id IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'a target profile, email, or phone is required' USING ERRCODE = '22023';
  END IF;
  IF p_target_user_id IS NOT NULL AND (v_email IS NOT NULL OR v_phone IS NOT NULL) THEN
    RAISE EXCEPTION 'invite either an existing profile or a contact, not both' USING ERRCODE = '22023';
  END IF;
  IF p_target_user_id = v_uid THEN
    RAISE EXCEPTION 'cannot invite yourself' USING ERRCODE = '22023';
  END IF;
  IF p_role IN ('leader', 'member') THEN
    RAISE EXCEPTION 'invite a role other than leader or plain member' USING ERRCODE = '22023';
  END IF;

  -- primary-leader gate: an active leader row for this community, not an
  -- admin override for co_leader (co_leaders cannot mint further co-creators
  -- in this slice -- see header note).
  IF NOT EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = p_community_id AND cm.user_id = v_uid
      AND cm.status = 'active' AND cm.role = 'leader'
  ) AND NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'primary leader required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = p_community_id AND c.status <> 'archived') THEN
    RAISE EXCEPTION 'community not found or archived' USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_target_user_id) THEN
      RAISE EXCEPTION 'that profile does not exist' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id = p_community_id AND cm.user_id = p_target_user_id
        AND cm.status = 'active' AND cm.role IN ('leader', 'co_leader')
    ) THEN
      RAISE EXCEPTION 'already a leader or co-creator of this community' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- resend supersedes rather than hard-fails: without this, the partial
  -- unique indexes above would raise a plain 23505 unique_violation on a
  -- second invite to the same still-outstanding target. Flip any existing
  -- pending/viewed row for this exact target to 'revoked' first, so the
  -- INSERT below always has a clear slot and the old token stops working
  -- immediately (matches revoke_co_creator_invite()'s own status flip).
  UPDATE public.community_creator_invites
  SET status = 'revoked', revoked_at = now(), revoked_by_user_id = v_uid
  WHERE community_id = p_community_id
    AND status IN ('pending', 'viewed')
    AND (
      (p_target_user_id IS NOT NULL AND target_user_id = p_target_user_id)
      OR (v_email IS NOT NULL AND target_email = v_email)
      OR (v_phone IS NOT NULL AND target_phone = v_phone)
    );

  -- token: two concatenated gen_random_uuid()s, no hyphens, core-Postgres
  -- only (~244 bits of randomness; see header note on why md5-at-rest is
  -- adequate here despite not being a cryptographic hash for this purpose).
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.community_creator_invites
    (community_id, invited_by_user_id, target_user_id, target_email, target_phone,
     role, token_hash, expires_at)
  VALUES
    (p_community_id, v_uid, p_target_user_id, v_email, v_phone, p_role, md5(v_token), v_expires)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_token, v_expires;
END;
$$;

-- Read-only, anon-callable: lets an unauthenticated deep-link open show
-- "you're invited to co-create {community}" before signup. Never returns the
-- full email/phone (masked hint only) and never grants or checks binding --
-- that only happens in accept_co_creator_invite(). Looking a token up here
-- does not consume it.
CREATE OR REPLACE FUNCTION public.preview_co_creator_invite(p_token text)
RETURNS TABLE(
  invite_id      uuid,
  community_id   uuid,
  community_name text,
  community_handle text,
  invited_by_name text,
  status         public.community_creator_invite_status,
  expires_at     timestamptz,
  target_hint    text,
  role           public.community_member_role
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
         coalesce(p.first_name_display, 'A community leader') AS inviter_name
  INTO v_invite
  FROM public.community_creator_invites i
  JOIN public.communities c ON c.id = i.community_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by_user_id
  WHERE i.token_hash = md5(p_token);

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- opening the preview IS the "viewed" event -- this function's whole
  -- purpose is showing an unauthenticated deep-link opener what they were
  -- invited to, so a look here is the only "viewed" signal this feature
  -- has. Guarded to only ever advance pending -> viewed, never overwrite a
  -- terminal state (accepted/revoked/expired) or re-touch an already-viewed
  -- row's timestamp semantics.
  IF v_invite.status = 'pending' AND v_invite.expires_at > now() THEN
    UPDATE public.community_creator_invites SET status = 'viewed' WHERE id = v_invite.id;
    v_invite.status := 'viewed';
  END IF;

  RETURN QUERY SELECT
    v_invite.id,
    v_invite.community_id,
    v_invite.c_name,
    v_invite.c_handle,
    v_invite.inviter_name,
    CASE WHEN v_invite.status IN ('pending', 'viewed') AND v_invite.expires_at <= now() THEN 'expired'::public.community_creator_invite_status
         ELSE v_invite.status END,
    v_invite.expires_at,
    CASE
      WHEN v_invite.target_email IS NOT NULL THEN
        left(v_invite.target_email, 1) || '***@' || split_part(v_invite.target_email, '@', 2)
      WHEN v_invite.target_phone IS NOT NULL THEN
        '***' || right(v_invite.target_phone, 4)
      ELSE NULL
    END,
    v_invite.role;
END;
$$;

-- THE BINDING ENFORCEMENT POINT. See header note. Exactly one of p_token or
-- p_invite_id identifies which invite; identity is NEVER taken from either
-- parameter, only from auth.uid() and the caller's own auth.users row.
CREATE OR REPLACE FUNCTION public.accept_co_creator_invite(
  p_token     text DEFAULT NULL,
  p_invite_id uuid DEFAULT NULL
)
RETURNS TABLE(community_id uuid, role public.community_member_role)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_invite       public.community_creator_invites%ROWTYPE;
  v_email_match  boolean := false;
  v_phone_match  boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF (p_token IS NULL OR btrim(p_token) = '') AND p_invite_id IS NULL THEN
    RAISE EXCEPTION 'a token or invite id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invite
  FROM public.community_creator_invites
  WHERE (p_token IS NOT NULL AND token_hash = md5(p_token))
     OR (p_invite_id IS NOT NULL AND id = p_invite_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found' USING ERRCODE = '22023';
  END IF;

  IF v_invite.status IN ('pending', 'viewed') AND v_invite.expires_at <= now() THEN
    UPDATE public.community_creator_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'this invite has expired' USING ERRCODE = '22023';
  END IF;
  IF v_invite.status NOT IN ('pending', 'viewed') THEN
    RAISE EXCEPTION 'this invite is no longer available' USING ERRCODE = '22023';
  END IF;

  -- === binding check: the caller's OWN server-verified identity only ===
  IF v_invite.target_user_id IS NOT NULL THEN
    IF v_invite.target_user_id <> v_uid THEN
      RAISE EXCEPTION 'this invite is not for you' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT
      (v_invite.target_email IS NOT NULL AND u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL
         AND lower(u.email) = v_invite.target_email),
      (v_invite.target_phone IS NOT NULL AND u.phone IS NOT NULL AND u.phone_confirmed_at IS NOT NULL
         AND regexp_replace(u.phone, '[^0-9]', '', 'g') = v_invite.target_phone)
    INTO v_email_match, v_phone_match
    FROM auth.users u
    WHERE u.id = v_uid;

    IF NOT (coalesce(v_email_match, false) OR coalesce(v_phone_match, false)) THEN
      RAISE EXCEPTION 'this invite is not for you' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- refuse outright rather than silently no-op: see header note on the
  -- ON CONFLICT ... WHERE status <> 'banned' clause below.
  IF EXISTS (
    SELECT 1 FROM public.community_members cm
    WHERE cm.community_id = v_invite.community_id AND cm.user_id = v_uid AND cm.status = 'banned'
  ) THEN
    RAISE EXCEPTION 'cannot accept: banned from this community' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
  VALUES (v_invite.community_id, v_uid, v_invite.role, 'active', now())
  ON CONFLICT (community_id, user_id) DO UPDATE
    SET role = v_invite.role, status = 'active',
        joined_at = coalesce(public.community_members.joined_at, now())
    WHERE public.community_members.status <> 'banned';

  UPDATE public.community_creator_invites
  SET status = 'accepted', accepted_at = now(), accepted_by_user_id = v_uid,
      target_user_id = coalesce(target_user_id, v_uid)
  WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.community_id, v_invite.role;
END;
$$;

-- Inviter, any active leader/co_leader of the community, or admin.
CREATE OR REPLACE FUNCTION public.revoke_co_creator_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_invite public.community_creator_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite FROM public.community_creator_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN; -- idempotent: already gone
  END IF;

  IF v_invite.invited_by_user_id <> v_uid
     AND NOT public.is_community_leader(v_invite.community_id, v_uid)
     AND NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorized to revoke this invite' USING ERRCODE = '42501';
  END IF;

  IF v_invite.status = 'pending' THEN
    UPDATE public.community_creator_invites
    SET status = 'revoked', revoked_at = now(), revoked_by_user_id = v_uid
    WHERE id = p_invite_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_co_creator_invite(uuid, uuid, text, text, public.community_member_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_co_creator_invite(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_co_creator_invite(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_co_creator_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_co_creator_invite(uuid, uuid, text, text, public.community_member_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_co_creator_invite(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.accept_co_creator_invite(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_co_creator_invite(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_creator_invites ENABLE ROW LEVEL SECURITY;

-- Visible to: the inviter, any active leader/co_leader of the community, the
-- bound target once target_user_id is set (existing-profile path, or after
-- acceptance), or admin. The email/phone-only pre-acceptance state is
-- deliberately invisible here -- that path is discovered only through
-- preview_co_creator_invite(token), never a table scan.
CREATE POLICY community_creator_invites_select ON public.community_creator_invites
  FOR SELECT USING (
    invited_by_user_id = (select auth.uid())
    OR target_user_id = (select auth.uid())
    OR is_community_leader(community_id, (select auth.uid()))
    OR is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)
  );

-- No INSERT or UPDATE policy: creation, acceptance, and revocation all go
-- through the SECURITY DEFINER RPCs above, matching create_community()'s
-- precedent. A raw client INSERT or UPDATE is rejected outright.
CREATE POLICY community_creator_invites_delete ON public.community_creator_invites
  FOR DELETE USING (is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- 4. schema self-test
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.community_creator_invites'::regclass) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: RLS not enabled on community_creator_invites';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'community_creator_invites') = 0 THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: no policies on community_creator_invites';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'community_creator_invites' AND cmd IN ('INSERT', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a client-facing INSERT/UPDATE policy exists (mutation must stay RPC-only)';
  END IF;
  RAISE NOTICE 'community_creator_invites schema self-test passed';
END $$;

-- ---------------------------------------------------------------------------
-- 5. live-row self-test: THE BINDING GUARANTEE, plus expiry / revoke / reuse
--    / leader-gating. Uses three real seeded non-admin users (Liz, Sage,
--    cafe0002 -- same fixtures as add_or_accept_person.sql and
--    answers_withhold_proposal_42.sql), simulates auth via transaction-local
--    jwt claims, and rolls back every mutation via the SELFTEST_ROLLBACK
--    savepoint pattern so it leaves zero trace. Never strip on apply.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_leader   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';  -- Liz: primary leader
  v_sage     uuid := 'cafe0001-0000-0000-0000-000000000001';  -- Sage: correct invitee
  v_other    uuid := 'cafe0002-0000-0000-0000-000000000002';  -- the wrong person
  v_cid      uuid;
  v_invite1  uuid; v_token1 text;
  v_invite2  uuid; v_token2 text;
  v_raised   boolean;
  v_role     public.community_member_role;
  v_status   public.community_creator_invite_status;
  v_other_email_before        text;
  v_other_email_confirmed_before timestamptz;
BEGIN
  IF v_leader IS NULL OR v_sage IS NULL OR v_other IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_leader)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_sage)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_other) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs the three seeded fixture users (Liz/Sage/cafe0002) to run';
  END IF;

  BEGIN
    -- ---- setup: Liz leads a fresh self-test community ----------------------
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    v_cid := public.create_community('selftest-cocreator-tmp', 'Self Test Co-Creator');

    -- ============ CASE 1: existing-profile invite, correct redemption ======
    SELECT invite_id, raw_token INTO v_invite1, v_token1
    FROM public.create_co_creator_invite(v_cid, p_target_user_id => v_sage);

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
    SELECT role INTO v_role FROM public.accept_co_creator_invite(p_invite_id => v_invite1);
    IF v_role IS DISTINCT FROM 'co_leader' THEN
      RAISE EXCEPTION 'self-test C1: expected co_leader, got %', v_role;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members
      WHERE community_id = v_cid AND user_id = v_sage AND role = 'co_leader' AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'self-test C1: Sage does not hold an active co_leader row';
    END IF;

    -- ============ CASE 2: single-use -- Sage cannot redeem it twice ========
    v_raised := false;
    BEGIN
      PERFORM public.accept_co_creator_invite(p_invite_id => v_invite1);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C2: an already-accepted invite was accepted again';
    END IF;

    -- ============ CASE 3: THE FORWARDED-LINK TEST ===========================
    -- Liz invites Sage again (a second, fresh invite -- Sage is already a
    -- co-creator now, so target a still-eligible person: demote Sage back to
    -- plain member first so a fresh invite to her is legal, then send it).
    UPDATE public.community_members SET role = 'member' WHERE community_id = v_cid AND user_id = v_sage;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    SELECT invite_id, raw_token INTO v_invite2, v_token2
    FROM public.create_co_creator_invite(v_cid, p_target_user_id => v_sage);

    -- the link leaks/gets forwarded to "the wrong person" (cafe0002), who has
    -- a real, authenticated, non-admin session and the CORRECT raw token --
    -- everything an attacker holding a leaked link would actually have.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.accept_co_creator_invite(p_token => v_token2);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C3 FAIL: a forwarded link granted access to the wrong person';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.community_members WHERE community_id = v_cid AND user_id = v_other
    ) THEN
      RAISE EXCEPTION 'self-test C3 FAIL: the wrong person got a membership row from a forwarded link';
    END IF;
    SELECT status INTO v_status FROM public.community_creator_invites WHERE id = v_invite2;
    IF v_status <> 'pending' THEN
      RAISE EXCEPTION 'self-test C3: the failed wrong-person attempt consumed the invite (status %)', v_status;
    END IF;

    -- the token still works for the person it was actually bound to
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
    SELECT role INTO v_role FROM public.accept_co_creator_invite(p_token => v_token2);
    IF v_role IS DISTINCT FROM 'co_leader' THEN
      RAISE EXCEPTION 'self-test C3: the correct recipient could not redeem their own token after the leak attempt';
    END IF;

    -- ============ CASE 4: email-bound invite (no account yet, then =========
    -- ============ redeemed by the matching VERIFIED identity) ==============
    SELECT email, email_confirmed_at INTO v_other_email_before, v_other_email_confirmed_before
    FROM auth.users WHERE id = v_other;
    UPDATE auth.users SET email = 'selftest-cocreator-target@example.com', email_confirmed_at = now()
    WHERE id = v_other;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    DECLARE
      v_invite3 uuid; v_token3 text;
    BEGIN
      SELECT invite_id, raw_token INTO v_invite3, v_token3
      FROM public.create_co_creator_invite(v_cid, p_target_email => 'Selftest-CoCreator-Target@Example.com  ');

      -- wrong person again (Sage), now targeting the EMAIL-bound branch
      -- specifically, not the target_user_id branch case 3 already covered
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
      v_raised := false;
      BEGIN
        PERFORM public.accept_co_creator_invite(p_token => v_token3);
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      IF NOT v_raised THEN
        RAISE EXCEPTION 'self-test C4 FAIL: an email-bound invite was accepted by someone whose verified email does not match';
      END IF;

      -- the actual matching, VERIFIED identity succeeds
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
      SELECT role INTO v_role FROM public.accept_co_creator_invite(p_token => v_token3);
      IF v_role IS DISTINCT FROM 'co_leader' THEN
        RAISE EXCEPTION 'self-test C4: the verified matching email holder could not redeem the invite';
      END IF;
    END;

    -- restore cafe0002's real email (defense in depth on top of the savepoint
    -- rollback below, in case this block is ever refactored to commit)
    UPDATE auth.users SET email = v_other_email_before, email_confirmed_at = v_other_email_confirmed_before
    WHERE id = v_other;

    -- ============ CASE 5: unverified contact cannot bind ====================
    -- an email invite where the caller's auth.users.email matches but
    -- email_confirmed_at is NULL must fail exactly like a mismatch.
    UPDATE public.community_members SET role = 'member' WHERE community_id = v_cid AND user_id = v_sage;
    UPDATE auth.users SET email = 'selftest-cocreator-unverified@example.com', email_confirmed_at = NULL
    WHERE id = v_sage;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    DECLARE
      v_invite4 uuid; v_token4 text;
    BEGIN
      SELECT invite_id, raw_token INTO v_invite4, v_token4
      FROM public.create_co_creator_invite(v_cid, p_target_email => 'selftest-cocreator-unverified@example.com');
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
      v_raised := false;
      BEGIN
        PERFORM public.accept_co_creator_invite(p_token => v_token4);
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      IF NOT v_raised THEN
        RAISE EXCEPTION 'self-test C5 FAIL: an unverified (unconfirmed) email was accepted as binding proof';
      END IF;
    END;

    -- ============ CASE 6: expiry =============================================
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    DECLARE
      v_invite5 uuid; v_token5 text;
    BEGIN
      SELECT invite_id, raw_token INTO v_invite5, v_token5
      FROM public.create_co_creator_invite(v_cid, p_target_user_id => v_other);
      UPDATE public.community_creator_invites SET expires_at = now() - interval '1 minute' WHERE id = v_invite5;

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
      v_raised := false;
      BEGIN
        PERFORM public.accept_co_creator_invite(p_token => v_token5);
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      IF NOT v_raised THEN
        RAISE EXCEPTION 'self-test C6 FAIL: an expired invite was accepted';
      END IF;
      SELECT status INTO v_status FROM public.community_creator_invites WHERE id = v_invite5;
      IF v_status <> 'expired' THEN
        RAISE EXCEPTION 'self-test C6: expired invite did not flip status (got %)', v_status;
      END IF;
    END;

    -- ============ CASE 7: revoke then accept fails ===========================
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    DECLARE
      v_invite6 uuid; v_token6 text;
    BEGIN
      SELECT invite_id, raw_token INTO v_invite6, v_token6
      FROM public.create_co_creator_invite(v_cid, p_target_user_id => v_other);
      PERFORM public.revoke_co_creator_invite(v_invite6);

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
      v_raised := false;
      BEGIN
        PERFORM public.accept_co_creator_invite(p_token => v_token6);
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      IF NOT v_raised THEN
        RAISE EXCEPTION 'self-test C7 FAIL: a revoked invite was accepted';
      END IF;
    END;

    -- ============ CASE 8: only the primary leader can invite ================
    -- Sage is currently a plain member (demoted above); a plain member must
    -- not be able to mint a co-creator invite.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.create_co_creator_invite(v_cid, p_target_user_id => v_other);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C8 FAIL: a non-leader was able to create a co-creator invite';
    END IF;

    -- ============ CASE 9: preview marks the invite viewed, and a viewed ====
    -- ============ invite (not just pending) can still be accepted ==========
    UPDATE public.community_members SET role = 'member' WHERE community_id = v_cid AND user_id = v_sage;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    DECLARE
      v_invite7 uuid; v_token7 text; v_preview_status public.community_creator_invite_status;
    BEGIN
      SELECT invite_id, raw_token INTO v_invite7, v_token7
      FROM public.create_co_creator_invite(v_cid, p_target_user_id => v_sage);

      -- an anon preview open (no jwt claim) is the "viewed" signal itself
      PERFORM set_config('request.jwt.claims', NULL, true);
      SELECT status INTO v_preview_status FROM public.preview_co_creator_invite(v_token7);
      IF v_preview_status IS DISTINCT FROM 'viewed' THEN
        RAISE EXCEPTION 'self-test C9: preview did not report viewed (got %)', v_preview_status;
      END IF;
      SELECT status INTO v_status FROM public.community_creator_invites WHERE id = v_invite7;
      IF v_status <> 'viewed' THEN
        RAISE EXCEPTION 'self-test C9: invite row did not persist viewed status (got %)', v_status;
      END IF;

      -- a second preview open must not error or un-flip it
      PERFORM public.preview_co_creator_invite(v_token7);

      -- the bound target can still accept a viewed (not just pending) invite
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
      SELECT role INTO v_role FROM public.accept_co_creator_invite(p_token => v_token7);
      IF v_role IS DISTINCT FROM 'co_leader' THEN
        RAISE EXCEPTION 'self-test C9 FAIL: a viewed invite could not be accepted';
      END IF;
    END;

    -- ============ CASE 10: resend supersedes instead of hard-failing =======
    UPDATE public.community_members SET role = 'member' WHERE community_id = v_cid AND user_id = v_other;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    DECLARE
      v_invite8a uuid; v_token8a text;
      v_invite8b uuid; v_token8b text;
      v_status8a public.community_creator_invite_status;
    BEGIN
      SELECT invite_id, raw_token INTO v_invite8a, v_token8a
      FROM public.create_co_creator_invite(v_cid, p_target_user_id => v_other);

      -- resend to the SAME still-outstanding target: must succeed (not a
      -- 23505 unique_violation off the partial indexes above) and must
      -- supersede the earlier invite, not sit alongside it.
      SELECT invite_id, raw_token INTO v_invite8b, v_token8b
      FROM public.create_co_creator_invite(v_cid, p_target_user_id => v_other);

      SELECT status INTO v_status8a FROM public.community_creator_invites WHERE id = v_invite8a;
      IF v_status8a <> 'revoked' THEN
        RAISE EXCEPTION 'self-test C10 FAIL: resend did not revoke the earlier outstanding invite (got %)', v_status8a;
      END IF;

      -- the OLD token must no longer work
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
      v_raised := false;
      BEGIN
        PERFORM public.accept_co_creator_invite(p_token => v_token8a);
      EXCEPTION WHEN OTHERS THEN v_raised := true;
      END;
      IF NOT v_raised THEN
        RAISE EXCEPTION 'self-test C10 FAIL: a superseded (revoked) old token was still accepted';
      END IF;

      -- the NEW token works
      SELECT role INTO v_role FROM public.accept_co_creator_invite(p_token => v_token8b);
      IF v_role IS DISTINCT FROM 'co_leader' THEN
        RAISE EXCEPTION 'self-test C10 FAIL: the new superseding invite could not be accepted';
      END IF;
    END;

    -- ============ CASE 11: S-03 -- a leader-role invite is refused =========
    -- (ownership transfer is a separate, unbuilt concern; see the S-03
    -- capabilities migration's header). Uses only 'leader', a label that
    -- existed before S-03 too, so this case runs correctly whether or not
    -- the S-03 enum migration has applied yet.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.create_co_creator_invite(v_cid, p_target_user_id => v_other, p_role => 'leader');
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C11 FAIL: an invite was created with role=leader (ownership transfer)';
    END IF;

    -- ============ CASE 12: S-03 -- a plain-member-role invite is refused ===
    v_raised := false;
    BEGIN
      PERFORM public.create_co_creator_invite(v_cid, p_target_user_id => v_other, p_role => 'member');
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C12 FAIL: an invite was created with role=member';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'community_creator_invites binding self-test passed (12 cases: the original 8, viewed-status-on-preview, resend-supersedes, plus S-03''s leader-role-refused and member-role-refused)';
END $$;

COMMIT;
