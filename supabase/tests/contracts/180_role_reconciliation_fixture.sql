\set ON_ERROR_STOP on

-- Fixture for Build 35 / P3 batch A item A3 (community role reconciliation).
-- Companion to
-- supabase/migrations/20260901000000_build35_community_role_reconciliation.sql.
--
-- Written for A4 (master plan v3 §5.1; see
-- clients/washed-up/specs/washedup-BUILD35-ROLE-RECONCILIATION-20260831.md
-- §3.9's summary table, which this contract exists to check row by row).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;

-- The live shape exactly as of 20260702184012_communities_skeleton.sql:58 --
-- three labels only. This is the load-bearing fact the reconciliation spec
-- depends on (§1.1): no ALTER TYPE ... ADD VALUE for this enum exists
-- anywhere in supabase/migrations/, so 'admin'/'events'/'member_care'/
-- 'finance' cannot be stored in real production today.
CREATE TYPE public.community_member_role AS ENUM ('leader', 'co_leader', 'member');

CREATE TABLE public.communities (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE public.community_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         public.community_member_role NOT NULL DEFAULT 'member',
  UNIQUE (community_id, user_id)
);

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'), -- leader
  ('00000000-0000-0000-0000-000000000002'), -- co_leader
  ('00000000-0000-0000-0000-000000000003'), -- plain member (must get no row)
  ('00000000-0000-0000-0000-000000000004'); -- second co_leader, removed later to test the CASCADE fk

INSERT INTO public.communities (id, name) VALUES
  ('40000000-0000-0000-0000-000000000001', 'Existing Community');

INSERT INTO public.community_members (id, community_id, user_id, role) VALUES
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'leader'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'co_leader'),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'member'),
  ('60000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'co_leader');

-- ---------------------------------------------------------------------------
-- Defensive/forward-looking coverage only, clearly separated from the real
-- shape above. specs/washedup-BUILD35-ROLE-RECONCILIATION-20260831.md §1.1-
-- §1.2 establishes that 'admin', 'events', 'member_care', and 'finance' are
-- NOT live anywhere -- the migration that would have added them
-- (20260821010000_community_role_tiers_enum.sql) was archived, unapplied.
-- The reconciliation migration nonetheless maps all seven shipped labels
-- (§3.9's summary table), and five of those seven branches are otherwise
-- untested by anything, anywhere, because Postgres will not let real
-- production store them. Widening the enum here, in this disposable
-- fixture only, is the one way to actually run that code.
--
-- Each ALTER TYPE below is its own top-level statement and therefore its
-- own implicit transaction under psql's autocommit -- confirmed against a
-- throwaway Postgres 17 container before this file was written, not
-- assumed from documentation. Postgres will not let a value added by
-- ALTER TYPE ... ADD VALUE be used inside the same transaction that added
-- it; committing each addition before the next statement is what makes the
-- INSERTs below legal.
-- ---------------------------------------------------------------------------
ALTER TYPE public.community_member_role ADD VALUE 'admin';
ALTER TYPE public.community_member_role ADD VALUE 'events';
ALTER TYPE public.community_member_role ADD VALUE 'member_care';
ALTER TYPE public.community_member_role ADD VALUE 'finance';

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000000005'), -- admin tier (archived, hypothetical)
  ('00000000-0000-0000-0000-000000000006'), -- events tier (archived, hypothetical)
  ('00000000-0000-0000-0000-000000000007'), -- member_care tier (archived, hypothetical)
  ('00000000-0000-0000-0000-000000000008'); -- finance tier (archived, hypothetical)

INSERT INTO public.community_members (id, community_id, user_id, role) VALUES
  ('60000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'admin'),
  ('60000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'events'),
  ('60000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'member_care'),
  ('60000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000008', 'finance');

SELECT 'FIXTURE: 8 community_members rows -- leader, 2x co_leader, member, plus 4 hypothetical widened-enum tiers' AS result;
