-- Circles (people + circles). 1/4: enum, core tables, membership helpers, RLS.
--
-- REVIEW ONLY. Not applied by the agent. Before applying to prod:
--   * Supabase preview branches are broken for this repo; apply directly,
--     transactionally, and rely on the trailing self-test to roll back.
--   * Reconcile assumptions against prod via Supabase MCP first. Verified
--     2026-05-30 against project upstjumasqblszevlgik:
--       - profiles.id uuid PK; event_members.user_id REFERENCES profiles(id)
--       - member_status enum = {joined,left,removed} (reused here for status)
--       - member_role enum = {host,guest} (NOT reused; circles get their own
--         circle_role = {admin,member} per the functional-spec admin model)
--       - has_role(uuid, app_role) exists (used for admin moderation reads)
--   * Additive only. No minimum-member CHECK by design: a 1:1 DM is modeled
--     as a 2-person circle on this same machinery, so a hard min-3 here would
--     force a redo if DMs land that way. The 3-person minimum is a UI rule for
--     user-created circles only.
--
-- Idempotent: re-running is a no-op. Wrapped BEGIN/COMMIT with a final
-- self-test DO block that RAISEs (forcing rollback) if any object is wrong.

BEGIN;

-- ---------------------------------------------------------------------------
-- circle_role: admin / member. This is what enables the spec's admin model.
-- The creator is seeded admin; "everyone is an admin" is simply every joined
-- member holding the admin role. Invitation rights derive from this role.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'circle_role') THEN
    CREATE TYPE public.circle_role AS ENUM ('admin', 'member');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- circles: the group itself.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.circles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  description     text,
  -- Nullable + SET NULL so a circle survives its creator deleting their
  -- account. The creator drops off the roster (circle_members.user_id is
  -- CASCADE) but the circle and its chat/history stay. If the creator was the
  -- sole admin, an adminless circle is an accepted V1 edge (transfer deferred).
  creator_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- cover photo source. No FK target yet (upload/cover origin is a design-v3
  -- decision); kept as a plain uuid so the column is stable now.
  cover_upload_id uuid,
  status          text NOT NULL DEFAULT 'forming',
  room_enabled    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT circles_status_check
    CHECK (status IN ('forming', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_circles_creator
  ON public.circles (creator_user_id);

-- ---------------------------------------------------------------------------
-- circle_members: membership + role. status reuses the existing member_status
-- enum {joined,left,removed} for consistency with event_members.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.circle_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id  uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       public.circle_role NOT NULL DEFAULT 'member',
  status     public.member_status NOT NULL DEFAULT 'joined',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT circle_members_circle_user_key UNIQUE (circle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_circle_members_circle
  ON public.circle_members (circle_id, status);
CREATE INDEX IF NOT EXISTS idx_circle_members_user
  ON public.circle_members (user_id, status);

-- ---------------------------------------------------------------------------
-- Membership helpers. SECURITY DEFINER so they bypass circle_members RLS:
-- this is what lets the SELECT policies below reference circle_members without
-- triggering recursive RLS evaluation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_circle_member(p_circle_id uuid, p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id
      AND cm.user_id = p_user_id
      AND cm.status = 'joined'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_circle_admin(p_circle_id uuid, p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id
      AND cm.user_id = p_user_id
      AND cm.status = 'joined'
      AND cm.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_circle_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_circle_admin(uuid, uuid)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_circle_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_circle_admin(uuid, uuid)  TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Members read their own circles; all writes go through the SECURITY
-- DEFINER RPCs in migration 4/4, so no INSERT/UPDATE/DELETE policies here.
-- ---------------------------------------------------------------------------
ALTER TABLE public.circles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS circles_select_member ON public.circles;
CREATE POLICY circles_select_member ON public.circles
  FOR SELECT TO authenticated
  USING (public.is_circle_member(id, auth.uid()));

DROP POLICY IF EXISTS circles_select_admin ON public.circles;
CREATE POLICY circles_select_admin ON public.circles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS circle_members_select_member ON public.circle_members;
CREATE POLICY circle_members_select_member ON public.circle_members
  FOR SELECT TO authenticated
  USING (public.is_circle_member(circle_id, auth.uid()));

DROP POLICY IF EXISTS circle_members_select_admin ON public.circle_members;
CREATE POLICY circle_members_select_admin ON public.circle_members
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- Self-test: assert the schema landed; RAISE rolls back the whole migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'circle_role') THEN
    RAISE EXCEPTION 'circle_role enum missing';
  END IF;
  IF (SELECT count(*) FROM unnest(enum_range(NULL::public.circle_role))) <> 2 THEN
    RAISE EXCEPTION 'circle_role must have exactly {admin, member}';
  END IF;
  IF to_regclass('public.circles') IS NULL THEN
    RAISE EXCEPTION 'circles table missing';
  END IF;
  -- creator_user_id must be nullable (circle survives creator deletion)
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='circles'
      AND column_name='creator_user_id' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'circles.creator_user_id must be nullable (ON DELETE SET NULL)';
  END IF;
  IF to_regclass('public.circle_members') IS NULL THEN
    RAISE EXCEPTION 'circle_members table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'is_circle_member' AND prosecdef
  ) THEN
    RAISE EXCEPTION 'is_circle_member must exist and be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'is_circle_admin' AND prosecdef
  ) THEN
    RAISE EXCEPTION 'is_circle_admin must exist and be SECURITY DEFINER';
  END IF;
END $$;

COMMIT;
