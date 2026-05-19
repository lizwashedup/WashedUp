-- Yours page rebuild — 1/6: tables, columns, indexes, RLS.
--
-- REVIEW ONLY. Not applied by the agent. Before applying to prod:
--   * Supabase preview branches are broken for this repo; apply directly,
--     transactionally, and rely on the trailing self-test to roll back.
--   * Reconcile assumptions against prod via Supabase MCP first. Verified
--     2026-05-16 against project upstjumasqblszevlgik:
--       - profiles.id uuid PK; no referral_code / plans_visible_to_people yet
--       - events.id uuid; event_status enum includes 'completed'
--       - block model: user_blocks(blocker_id,blocked_id) + legacy
--         profiles.blocked_users uuid[]
--   * This migration is additive only and safe to ship ahead of the flag.
--
-- Idempotent: re-running is a no-op. Wrapped BEGIN/COMMIT with a final
-- self-test DO block that RAISEs (forcing rollback) if any object is wrong.

BEGIN;

-- ---------------------------------------------------------------------------
-- profiles: referral code + global plan visibility
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS plans_visible_to_people boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key
  ON public.profiles (referral_code)
  WHERE referral_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- people_connections: directional mutual-request state machine
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.people_connections (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'pending',
  can_re_request       boolean NOT NULL DEFAULT true,
  context              text NOT NULL,
  context_event_id     uuid REFERENCES public.events(id) ON DELETE SET NULL,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  responded_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_connections_status_check
    CHECK (status IN ('pending','accepted','declined','removed')),
  CONSTRAINT people_connections_context_check
    CHECK (context IN ('plan_history','handle_lookup','referral_invite')),
  CONSTRAINT people_connections_not_self
    CHECK (requester_user_id <> recipient_user_id),
  CONSTRAINT people_connections_pair_key
    UNIQUE (requester_user_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_recipient_status
  ON public.people_connections (recipient_user_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_requester_status
  ON public.people_connections (requester_user_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_accepted_pair
  ON public.people_connections (requester_user_id, recipient_user_id)
  WHERE status = 'accepted';

-- ---------------------------------------------------------------------------
-- people_pings: lightweight plan nudge
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.people_pings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_pings_not_self CHECK (sender_user_id <> recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_pings_recipient
  ON public.people_pings (recipient_user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_pings_dedup
  ON public.people_pings (sender_user_id, recipient_user_id, event_id);

-- ---------------------------------------------------------------------------
-- referral_invites: ghost-avatar / text-invite tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_invites (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_phone_hash   text NOT NULL,
  invited_contact_name text,
  referral_code        text NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
  referred_user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_at           timestamptz NOT NULL DEFAULT now(),
  signed_up_at         timestamptz,
  CONSTRAINT referral_invites_status_check
    CHECK (status IN ('pending','signed_up','added_to_people')),
  CONSTRAINT referral_invites_ghost_dedupe
    UNIQUE (inviter_user_id, invited_phone_hash)
);

CREATE INDEX IF NOT EXISTS idx_ri_phone_hash_pending
  ON public.referral_invites (invited_phone_hash)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ri_referral_code
  ON public.referral_invites (referral_code);

-- ---------------------------------------------------------------------------
-- people_plan_visibility: per-person "hide my upcoming plans from [Name]".
-- Directional (owner hides from viewer), independent of who requested the
-- connection, so A->B and B->A overrides are stored separately. Global
-- profiles.plans_visible_to_people is the kill switch; this is the
-- additive-restrictive per-person override (see is_plan_visible_to, 2/6).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.people_plan_visibility (
  owner_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  viewer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hidden         boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, viewer_user_id),
  CONSTRAINT people_plan_visibility_not_self
    CHECK (owner_user_id <> viewer_user_id)
);

-- ---------------------------------------------------------------------------
-- RLS — read-only for owners; all writes go through SECURITY DEFINER RPCs
-- (migrations 3 & 4). Defense-in-depth REVOKEs mirror the audit-hardening
-- migration pattern.
-- ---------------------------------------------------------------------------
ALTER TABLE public.people_connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people_pings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_invites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people_plan_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pc_select_own ON public.people_connections;
CREATE POLICY pc_select_own ON public.people_connections
  FOR SELECT TO authenticated
  USING (auth.uid() IN (requester_user_id, recipient_user_id));

DROP POLICY IF EXISTS pings_select_own ON public.people_pings;
CREATE POLICY pings_select_own ON public.people_pings
  FOR SELECT TO authenticated
  USING (auth.uid() IN (sender_user_id, recipient_user_id));

DROP POLICY IF EXISTS ri_select_own ON public.referral_invites;
CREATE POLICY ri_select_own ON public.referral_invites
  FOR SELECT TO authenticated
  USING (auth.uid() = inviter_user_id);

DROP POLICY IF EXISTS ppv_select_own ON public.people_plan_visibility;
CREATE POLICY ppv_select_own ON public.people_plan_visibility
  FOR SELECT TO authenticated
  USING (auth.uid() IN (owner_user_id, viewer_user_id));

REVOKE INSERT, UPDATE, DELETE ON public.people_connections     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.people_pings           FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.referral_invites       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.people_plan_visibility FROM anon, authenticated;
GRANT SELECT ON public.people_connections     TO authenticated;
GRANT SELECT ON public.people_pings           TO authenticated;
GRANT SELECT ON public.referral_invites       TO authenticated;
GRANT SELECT ON public.people_plan_visibility TO authenticated;

-- ---------------------------------------------------------------------------
-- Self-test: any failure RAISEs and rolls back the whole migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.people_connections') IS NULL
     OR to_regclass('public.people_pings') IS NULL
     OR to_regclass('public.referral_invites') IS NULL THEN
    RAISE EXCEPTION 'self-test: a yours table is missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.people_connections'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.people_pings'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.referral_invites'::regclass) THEN
    RAISE EXCEPTION 'self-test: RLS not enabled on a yours table';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles'
                   AND column_name IN ('referral_code','plans_visible_to_people')
                 HAVING count(*) = 2) THEN
    RAISE EXCEPTION 'self-test: profiles missing referral_code / plans_visible_to_people';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'people_connections_pair_key') THEN
    RAISE EXCEPTION 'self-test: people_connections unique pair constraint missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'referral_invites_ghost_dedupe') THEN
    RAISE EXCEPTION 'self-test: referral_invites ghost-dedupe constraint missing';
  END IF;

  IF to_regclass('public.idx_pc_accepted_pair') IS NULL THEN
    RAISE EXCEPTION 'self-test: partial accepted-pair index missing';
  END IF;

  IF to_regclass('public.people_plan_visibility') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class
             WHERE oid = 'public.people_plan_visibility'::regclass) THEN
    RAISE EXCEPTION 'self-test: people_plan_visibility missing or RLS off';
  END IF;
END $$;

COMMIT;
