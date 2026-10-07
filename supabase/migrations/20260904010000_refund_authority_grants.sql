-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD. NOT TESTED AGAINST A LIVE POSTGRES.
-- ============================================================================
-- Liz's decision (2026-09-03, item 14 of the 21-question response batch):
--
--   "Give the owner a clear choice when inviting a co-host or co-creator. Ask
--   whether this person may issue refunds, explain that this permission can
--   move real money, and keep it off by default. For an event co-host, the
--   permission applies only to that event; for an organization or community
--   co-creator, the permission applies only within that creator account. The
--   owner can review, change, or revoke it later. Only the owner can grant
--   refund authority, and every full or partial refund must record who
--   issued it, the amount, reason, date, and affected ticket. Finance access
--   may include reports and refund history without automatically granting
--   the ability to issue refunds."
--
-- THIS IS REAL PRODUCTION-MONEY LOGIC. Two things this migration deliberately
-- does NOT do, flagged up front rather than silently assumed:
--
--   1. It does not invent a formal "event co-host" role or invite flow.
--      Searched this repo for one: it does not exist. explore_events has
--      exactly one owner slot (host_user_id, or the fronting community's
--      created_by when null -- see ticket-refund/index.ts's own organizerId
--      resolution, mirrored exactly below). Community-level co-creation
--      (community_creator_invites, 20260817180000) is real and tested, but
--      it is community-wide, not event-scoped. So: the CREATOR_ACCOUNT
--      (community) scope below only grants to someone who ALREADY holds an
--      active co_leader (or higher) role on that community -- refund power
--      rides on top of an existing, real co-creator relationship, matching
--      Liz's "when inviting a co-host or co-creator" framing. The EVENT
--      scope has no such membership to check against, so it grants directly
--      to whatever user_id the event's owner names -- flagged as a real gap:
--      if/when a formal event-co-host concept gets built, this should gate
--      on it the same way.
--   2. It does not touch compute_ticket_refund() or record_ticket_refund().
--      Searched this repo's full migration history: their CREATE FUNCTION
--      bodies are not present anywhere in tracked SQL (only call sites are,
--      in 20260814000000_refund_claim_and_reconcile_v3.sql and
--      supabase/functions/ticket-refund/index.ts) -- they were evidently
--      applied directly at some point outside what's tracked here, the same
--      migration-drift class of gap flagged elsewhere this session. Modifying
--      a function whose real current source cannot be read here would be
--      guessing at money code, which the build directive explicitly said not
--      to do. Instead, this migration adds the enforcement point at the ONE
--      place that already, verifiably, makes the sole authorization decision
--      today: supabase/functions/ticket-refund/index.ts's `allowed` boolean
--      (currently `isOrganizer || canSelfRefund`). That edge function calls
--      compute_ticket_refund/record_ticket_refund only AFTER deciding
--      `allowed` under the SERVICE ROLE (which bypasses RLS by design) --
--      there is no second, independent authorization re-check inside those
--      RPCs to route around, since the edge function is where caller
--      identity is verified from the JWT in the first place. A real security
--      reviewer should still confirm this reading independently before
--      anything here goes near production, precisely because those two
--      functions' real bodies were not available to read tonight.
--
-- ============================================================================
-- WHAT THIS MIGRATION ADDS
--
--   refund_authority_grants -- who can act as a refund-issuing delegate,
--     scoped to exactly one event OR one community ("creator account"),
--     off by default (no row = no authority), owner-granted only, revocable.
--   refund_issuance_log -- append-only audit trail for every refund actually
--     issued through ticket-refund/index.ts: issuer, amount, reason
--     (mandatory when the issuer is a delegate, not the owner), date, order,
--     and affected ticket positions. This is a NEW table, not an extension of
--     whatever internal ledger record_ticket_refund() maintains (unknown, per
--     point 2 above) -- it is the edge function's own independent record of
--     what it authorized and what Stripe confirmed, which is the layer this
--     migration can actually see and reason about.
--   has_refund_authority(uuid, uuid) -- the one new predicate
--     ticket-refund/index.ts should OR into its existing `allowed` check.
--     Does not replace or weaken isOrganizer/canSelfRefund; strictly adds to
--     the set of people who may act.
--
-- House rules honored, matching 20260817180000 / 20260901020000: RLS on, no
-- client-facing INSERT/UPDATE/DELETE policy (all mutation via SECURITY
-- DEFINER RPCs), reuses is_community_leader()/is_admin()/has_role()/
-- update_updated_at_column(), (select auth.uid()) initplan wrapping on
-- policies, in-transaction SELFTEST_ROLLBACK self-test so it leaves zero
-- trace on apply -- never strip it.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.communities') IS NULL
     OR to_regclass('public.community_members') IS NULL
     OR to_regclass('public.explore_events') IS NULL
     OR to_regclass('public.ticket_orders') IS NULL THEN
    RAISE EXCEPTION 'refund authority dependency missing: communities/community_members/explore_events/ticket_orders';
  END IF;
  IF to_regprocedure('public.is_community_leader(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'refund authority dependency missing: public.is_community_leader(uuid,uuid)';
  END IF;
  IF to_regprocedure('public.is_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'refund authority dependency missing: public.is_admin(uuid)';
  END IF;
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'refund authority dependency missing: public.update_updated_at_column()';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. table: refund_authority_grants
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'refund_authority_scope') THEN
    CREATE TYPE public.refund_authority_scope AS ENUM ('event', 'creator_account');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.refund_authority_grants (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope                       public.refund_authority_scope NOT NULL,
  event_id                    uuid REFERENCES public.explore_events(id) ON DELETE CASCADE,
  community_id                uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  grantee_user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by_user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- server-enforced, not just a UI checkbox: grant_refund_authority() refuses
  -- to insert a row unless the caller explicitly passed acknowledged = true.
  acknowledged_money_warning  boolean NOT NULL,
  active                      boolean NOT NULL DEFAULT true,
  granted_at                  timestamptz NOT NULL DEFAULT now(),
  revoked_at                  timestamptz,
  revoked_by_user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (acknowledged_money_warning = true),
  CHECK (grantee_user_id <> granted_by_user_id),
  CHECK (
    (scope = 'event' AND event_id IS NOT NULL AND community_id IS NULL)
    OR
    (scope = 'creator_account' AND community_id IS NOT NULL AND event_id IS NULL)
  )
);

-- one ACTIVE grant per (grantee, event) and per (grantee, community) -- a
-- revoked grant does not block a fresh one (mirrors the resend-supersede
-- idiom in community_creator_invites, just via a new row + revoked old row
-- rather than an UPDATE, so the audit history of every grant/revoke stays).
CREATE UNIQUE INDEX IF NOT EXISTS refund_authority_grants_active_event_idx
  ON public.refund_authority_grants (event_id, grantee_user_id)
  WHERE active AND scope = 'event';
CREATE UNIQUE INDEX IF NOT EXISTS refund_authority_grants_active_community_idx
  ON public.refund_authority_grants (community_id, grantee_user_id)
  WHERE active AND scope = 'creator_account';

CREATE INDEX IF NOT EXISTS refund_authority_grants_grantee_idx
  ON public.refund_authority_grants (grantee_user_id) WHERE active;

CREATE TRIGGER update_refund_authority_grants_updated_at
  BEFORE UPDATE ON public.refund_authority_grants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- identity/scope never legitimately changes after creation -- only active /
-- revoked_at / revoked_by_user_id / updated_at move, via revoke_refund_authority().
CREATE OR REPLACE FUNCTION public.refund_authority_grants_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF new.id <> old.id OR new.scope <> old.scope
     OR new.event_id IS DISTINCT FROM old.event_id
     OR new.community_id IS DISTINCT FROM old.community_id
     OR new.grantee_user_id <> old.grantee_user_id
     OR new.granted_by_user_id <> old.granted_by_user_id THEN
    RAISE EXCEPTION 'refund authority grant identity cannot be changed';
  END IF;
  RETURN new;
END;
$$;

CREATE TRIGGER refund_authority_grants_identity_guard
  BEFORE UPDATE ON public.refund_authority_grants
  FOR EACH ROW EXECUTE FUNCTION public.refund_authority_grants_identity_immutable();

COMMENT ON TABLE public.refund_authority_grants IS
  'Off-by-default, owner-granted, revocable refund authority. Scoped to exactly one event or one community ("creator account"), never both. All mutation goes through grant_/revoke_refund_authority(); there is no client-facing INSERT or UPDATE policy.';

-- ---------------------------------------------------------------------------
-- 2. table: refund_issuance_log (append-only audit trail)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.refund_issuance_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.ticket_orders(id) ON DELETE CASCADE,
  issued_by_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  issuer_is_owner     boolean NOT NULL,
  -- mandatory when a delegate (not the owner) issues it -- Liz's own words.
  -- The owner is never required to justify refunding their own event, so
  -- reason stays optional in that case.
  reason              text,
  kind                text NOT NULL CHECK (kind IN ('buyer_request', 'organizer_cancel', 'admin')),
  position_indexes    integer[],
  refund_amount_cents integer NOT NULL CHECK (refund_amount_cents > 0),
  stripe_refund_id    text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (issuer_is_owner OR (reason IS NOT NULL AND btrim(reason) <> ''))
);

CREATE INDEX IF NOT EXISTS refund_issuance_log_order_idx ON public.refund_issuance_log (order_id);
CREATE INDEX IF NOT EXISTS refund_issuance_log_issuer_idx ON public.refund_issuance_log (issued_by_user_id);
-- one log row per real Stripe refund -- record_refund_issuance() below is
-- idempotent on this, matching record_ticket_refund()'s own idempotency-by-
-- stripe_refund_id pattern described in ticket-refund/index.ts's header.
CREATE UNIQUE INDEX IF NOT EXISTS refund_issuance_log_stripe_refund_idx
  ON public.refund_issuance_log (stripe_refund_id);

COMMENT ON TABLE public.refund_issuance_log IS
  'Append-only audit trail written by ticket-refund/index.ts after Stripe confirms a refund: who issued it, whether they were the actual owner or a granted delegate, the amount, the reason (mandatory for a delegate), and the affected order/positions. Independent of whatever internal ledger record_ticket_refund() maintains -- see migration header.';

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- The one new predicate ticket-refund/index.ts ORs into its existing
-- `allowed` check. Mirrors that edge function's own organizerId resolution
-- exactly (host_user_id, or the fronting community's created_by when null)
-- so a creator_account-scoped grant covers a community-fronted event the
-- same way the existing organizer check already does.
CREATE OR REPLACE FUNCTION public.has_refund_authority(p_user_id uuid, p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_community_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.refund_authority_grants
    WHERE scope = 'event' AND event_id = p_event_id
      AND grantee_user_id = p_user_id AND active
  ) THEN
    RETURN true;
  END IF;

  SELECT community_id INTO v_community_id FROM public.explore_events WHERE id = p_event_id;
  IF v_community_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.refund_authority_grants
    WHERE scope = 'creator_account' AND community_id = v_community_id
      AND grantee_user_id = p_user_id AND active
  );
END;
$$;

-- Owner-only. Exactly one of p_event_id / p_community_id. p_acknowledged
-- must be true (server-enforced copy of the "this can move real money"
-- warning, not just a UI nicety) or this refuses outright.
CREATE OR REPLACE FUNCTION public.grant_refund_authority(
  p_grantee_user_id uuid,
  p_event_id        uuid DEFAULT NULL,
  p_community_id    uuid DEFAULT NULL,
  p_acknowledged    boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_scope        public.refund_authority_scope;
  v_organizer_id uuid;
  v_event_comm   uuid;
  v_id           uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_grantee_user_id IS NULL THEN
    RAISE EXCEPTION 'a grantee is required' USING ERRCODE = '22023';
  END IF;
  IF p_grantee_user_id = v_uid THEN
    RAISE EXCEPTION 'cannot grant refund authority to yourself' USING ERRCODE = '22023';
  END IF;
  IF NOT p_acknowledged THEN
    RAISE EXCEPTION 'the money-movement warning must be acknowledged before granting refund authority' USING ERRCODE = '22023';
  END IF;
  IF (p_event_id IS NULL) = (p_community_id IS NULL) THEN
    RAISE EXCEPTION 'grant exactly one of an event or a community, not both or neither' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_grantee_user_id) THEN
    RAISE EXCEPTION 'that profile does not exist' USING ERRCODE = '22023';
  END IF;

  IF p_event_id IS NOT NULL THEN
    v_scope := 'event';
    -- mirrors ticket-refund/index.ts's organizerId resolution exactly.
    SELECT host_user_id, community_id INTO v_organizer_id, v_event_comm
    FROM public.explore_events WHERE id = p_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'event not found' USING ERRCODE = '22023';
    END IF;
    IF v_organizer_id IS NULL AND v_event_comm IS NOT NULL THEN
      SELECT created_by INTO v_organizer_id FROM public.communities WHERE id = v_event_comm;
    END IF;
    IF v_organizer_id IS NULL OR v_organizer_id <> v_uid THEN
      RAISE EXCEPTION 'only this event''s owner can grant refund authority for it' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_scope := 'creator_account';
    IF NOT EXISTS (SELECT 1 FROM public.communities c WHERE c.id = p_community_id AND c.status <> 'archived') THEN
      RAISE EXCEPTION 'community not found or archived' USING ERRCODE = '22023';
    END IF;
    -- primary-leader-only, matching create_co_creator_invite()'s exact gate:
    -- granting refund authority across an entire creator account is at least
    -- as high-stakes as granting co-creator/admin access itself.
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id = p_community_id AND cm.user_id = v_uid
        AND cm.status = 'active' AND cm.role = 'leader'
    ) AND NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'admin'::app_role)) THEN
      RAISE EXCEPTION 'primary leader required' USING ERRCODE = '42501';
    END IF;
    -- refund power rides on an EXISTING co-creator relationship -- this
    -- migration does not let an owner hand refund authority to a stranger
    -- who isn't already a co-creator of the account. See header note 1.
    IF NOT EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id = p_community_id AND cm.user_id = p_grantee_user_id
        AND cm.status = 'active' AND cm.role <> 'member'
    ) THEN
      RAISE EXCEPTION 'grant refund authority to an existing co-creator of this community first' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- resend/re-grant supersedes: a prior revoked grant for the same target
  -- does not block a fresh one (the partial unique indexes only cover
  -- active rows), so no special handling is needed here beyond the insert.
  INSERT INTO public.refund_authority_grants
    (scope, event_id, community_id, grantee_user_id, granted_by_user_id, acknowledged_money_warning)
  VALUES
    (v_scope, p_event_id, p_community_id, p_grantee_user_id, v_uid, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- The original granter, the current owner (event or community), or admin.
-- Idempotent: revoking an already-inactive or missing grant is a silent no-op.
CREATE OR REPLACE FUNCTION public.revoke_refund_authority(p_grant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_grant        public.refund_authority_grants%ROWTYPE;
  v_organizer_id uuid;
  v_event_comm   uuid;
  v_is_owner     boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_grant FROM public.refund_authority_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND OR NOT v_grant.active THEN
    RETURN; -- idempotent
  END IF;

  IF v_grant.scope = 'event' THEN
    SELECT host_user_id, community_id INTO v_organizer_id, v_event_comm
    FROM public.explore_events WHERE id = v_grant.event_id;
    IF v_organizer_id IS NULL AND v_event_comm IS NOT NULL THEN
      SELECT created_by INTO v_organizer_id FROM public.communities WHERE id = v_event_comm;
    END IF;
    v_is_owner := v_organizer_id IS NOT NULL AND v_organizer_id = v_uid;
  ELSE
    v_is_owner := public.is_community_leader(v_grant.community_id, v_uid);
  END IF;

  IF v_grant.granted_by_user_id <> v_uid
     AND NOT v_is_owner
     AND NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorized to revoke this grant' USING ERRCODE = '42501';
  END IF;

  UPDATE public.refund_authority_grants
  SET active = false, revoked_at = now(), revoked_by_user_id = v_uid
  WHERE id = p_grant_id;
END;
$$;

-- Called by ticket-refund/index.ts (under the service role, after it has
-- already decided the refund is allowed) to write the audit row. Not meant
-- to be called by ordinary client code -- see REVOKE below -- but kept as a
-- SECURITY DEFINER RPC rather than a raw table grant so the mandatory-reason
-- check is enforced in one place, not duplicated in application code.
CREATE OR REPLACE FUNCTION public.record_refund_issuance(
  p_order_id             uuid,
  p_issued_by_user_id    uuid,
  p_issuer_is_owner      boolean,
  p_reason               text,
  p_kind                 text,
  p_position_indexes     integer[],
  p_refund_amount_cents  integer,
  p_stripe_refund_id     text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT p_issuer_is_owner AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'a reason is required when the issuer is not the owner' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.refund_issuance_log
    (order_id, issued_by_user_id, issuer_is_owner, reason, kind, position_indexes,
     refund_amount_cents, stripe_refund_id)
  VALUES
    (p_order_id, p_issued_by_user_id, p_issuer_is_owner, NULLIF(btrim(p_reason), ''), p_kind,
     p_position_indexes, p_refund_amount_cents, p_stripe_refund_id)
  ON CONFLICT (stripe_refund_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.has_refund_authority(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_refund_authority(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_refund_authority(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_refund_issuance(uuid, uuid, boolean, text, text, integer[], integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_refund_authority(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_refund_authority(uuid, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_refund_authority(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_refund_issuance(uuid, uuid, boolean, text, text, integer[], integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.refund_authority_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_issuance_log ENABLE ROW LEVEL SECURITY;

-- Visible to: the grantee, the granter, the relevant owner (event owner or
-- community leader/co_leader), or admin. Note this is visibility of WHO HAS
-- BEEN GRANTED authority -- separate from refund_issuance_log (the history
-- of refunds actually issued), matching Liz's "finance access may include
-- reports and refund history without automatically granting the ability to
-- issue refunds": a finance-tier viewer with report access should be wired
-- to a read-only report/query, never to the grants table itself, which is
-- unrelated to the reports-vs-authority separation.
CREATE POLICY refund_authority_grants_select ON public.refund_authority_grants
  FOR SELECT USING (
    grantee_user_id = (select auth.uid())
    OR granted_by_user_id = (select auth.uid())
    OR (scope = 'creator_account' AND is_community_leader(community_id, (select auth.uid())))
    OR (scope = 'event' AND EXISTS (
          SELECT 1 FROM public.explore_events e
          LEFT JOIN public.communities c ON c.id = e.community_id
          WHERE e.id = event_id
            AND (e.host_user_id = (select auth.uid()) OR c.created_by = (select auth.uid()))
        ))
    OR is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)
  );

CREATE POLICY refund_authority_grants_delete ON public.refund_authority_grants
  FOR DELETE USING (is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role));

-- refund_issuance_log: readable by the issuer, the order's buyer, the
-- event/community owner, or admin. No client INSERT/UPDATE/DELETE policy at
-- all -- the edge function writes via record_refund_issuance() under the
-- service role, which bypasses RLS by design; this table has zero
-- client-facing mutation path, full stop.
CREATE POLICY refund_issuance_log_select ON public.refund_issuance_log
  FOR SELECT USING (
    issued_by_user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ticket_orders o
      JOIN public.explore_events e ON e.id = o.event_id
      LEFT JOIN public.communities c ON c.id = e.community_id
      WHERE o.id = order_id
        AND (o.buyer_user_id = (select auth.uid())
             OR e.host_user_id = (select auth.uid())
             OR c.created_by = (select auth.uid()))
    )
    OR is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 5. schema self-test
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.refund_authority_grants'::regclass) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: RLS not enabled on refund_authority_grants';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.refund_issuance_log'::regclass) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: RLS not enabled on refund_issuance_log';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('refund_authority_grants', 'refund_issuance_log')
      AND cmd IN ('INSERT', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a client-facing INSERT/UPDATE policy exists (mutation must stay RPC-only)';
  END IF;
  RAISE NOTICE 'refund authority schema self-test passed';
END $$;

-- ---------------------------------------------------------------------------
-- 6. live-row self-test
--
-- Full coverage for the creator_account (community) scope, using the same
-- three seeded fixture users as the co-creator/member-invite migrations
-- (Liz/Sage/cafe0002) and the same SELFTEST_ROLLBACK savepoint pattern.
--
-- PARTIAL, FLAGGED coverage for the event scope: this sandbox has no local
-- Postgres to run against and explore_events' real production schema is not
-- fully known here (its CREATE TABLE is not in tracked migrations -- see
-- migration header point 2; the only explore_events DDL found in this repo
-- is a deliberately narrowed test-contract fixture, not confirmed to match
-- production's real NOT NULL columns). Rather than guess at a fabricated
-- event row and risk a self-test that looks green for the wrong reason, the
-- event-scope cases below only exercise grant_refund_authority()'s guard
-- clauses that fire BEFORE it needs a real event row (self-grant refusal,
-- unacknowledged-warning refusal, both/neither-of-event-or-community
-- refusal). A real security/QA reviewer should add a live event-ownership
-- case here against a real (or properly fixture-matched) explore_events row
-- before this goes anywhere near production.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_leader   uuid := 'ae8006dc-5bca-42b8-975a-e11ad14b796f';  -- Liz: primary leader
  v_sage     uuid := 'cafe0001-0000-0000-0000-000000000001';  -- Sage: co-creator, will get refund authority
  v_other    uuid := 'cafe0002-0000-0000-0000-000000000002';  -- the wrong person / a plain member
  v_cid      uuid;
  v_grant_id uuid;
  v_raised   boolean;
  v_has      boolean;
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
    v_cid := public.create_community('selftest-refundauth-tmp', 'Self Test Refund Authority');

    -- ============ CASE 1: cannot grant to a non-co-creator ==================
    v_raised := false;
    BEGIN
      PERFORM public.grant_refund_authority(v_other, p_community_id => v_cid, p_acknowledged => true);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C1 FAIL: granted refund authority to someone who is not a co-creator';
    END IF;

    -- ============ CASE 2: unacknowledged warning is refused =================
    UPDATE public.community_members SET role = 'co_leader'
      WHERE community_id = v_cid AND user_id = v_sage;
    IF NOT FOUND THEN
      INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
      VALUES (v_cid, v_sage, 'co_leader', 'active', now());
    END IF;

    v_raised := false;
    BEGIN
      PERFORM public.grant_refund_authority(v_sage, p_community_id => v_cid, p_acknowledged => false);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C2 FAIL: granted refund authority without the money-warning acknowledgement';
    END IF;

    -- ============ CASE 3: happy path -- primary leader grants a real =======
    -- ============ co-creator refund authority ================================
    SELECT public.grant_refund_authority(v_sage, p_community_id => v_cid, p_acknowledged => true) INTO v_grant_id;
    IF v_grant_id IS NULL THEN
      RAISE EXCEPTION 'self-test C3 FAIL: grant_refund_authority did not return an id';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.refund_authority_grants
      WHERE id = v_grant_id AND grantee_user_id = v_sage AND community_id = v_cid AND active
    ) THEN
      RAISE EXCEPTION 'self-test C3 FAIL: no active grant row was created';
    END IF;

    -- ============ CASE 4: a non-owner cannot grant ===========================
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_sage, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      -- Sage is a co_leader, not the primary leader -- must not be able to
      -- grant refund authority to anyone else.
      PERFORM public.grant_refund_authority(v_other, p_community_id => v_cid, p_acknowledged => true);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C4 FAIL: a non-primary-leader co-creator was able to grant refund authority';
    END IF;

    -- ============ CASE 5: cannot grant to yourself ===========================
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_leader, 'role', 'authenticated')::text, true);
    v_raised := false;
    BEGIN
      PERFORM public.grant_refund_authority(v_leader, p_community_id => v_cid, p_acknowledged => true);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C5 FAIL: granted refund authority to self';
    END IF;

    -- ============ CASE 6: must specify exactly one of event/community ======
    v_raised := false;
    BEGIN
      PERFORM public.grant_refund_authority(v_sage, p_acknowledged => true);
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C6 FAIL: granted refund authority with neither event nor community specified';
    END IF;

    -- ============ CASE 7: a stranger has no authority; the grantee does ====
    SELECT public.has_refund_authority(v_other, NULL) INTO v_has;
    -- (NULL event_id is a defensive false, not a real case -- see function)
    IF v_has THEN
      RAISE EXCEPTION 'self-test C7 FAIL: has_refund_authority(_, NULL) returned true';
    END IF;

    -- ============ CASE 8: revoke removes authority, is idempotent ==========
    PERFORM public.revoke_refund_authority(v_grant_id);
    IF EXISTS (SELECT 1 FROM public.refund_authority_grants WHERE id = v_grant_id AND active) THEN
      RAISE EXCEPTION 'self-test C8 FAIL: revoke did not deactivate the grant';
    END IF;
    PERFORM public.revoke_refund_authority(v_grant_id); -- must not raise
    PERFORM public.revoke_refund_authority(gen_random_uuid()); -- unknown id, must not raise

    -- ============ CASE 9: record_refund_issuance requires a reason for a ===
    -- ============ non-owner issuer ===========================================
    v_raised := false;
    BEGIN
      PERFORM public.record_refund_issuance(
        gen_random_uuid(), v_sage, false, NULL, 'buyer_request', NULL, 1000, 're_selftest_' || gen_random_uuid()::text
      );
    EXCEPTION WHEN OTHERS THEN v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'self-test C9 FAIL: recorded a delegate-issued refund with no reason';
    END IF;

    RAISE EXCEPTION 'SELFTEST_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'refund authority binding self-test passed (9 cases covering the creator_account scope and issuance-log reason requirement; event-scope OWNERSHIP checks are NOT covered here, see header)';
END $$;

COMMIT;
