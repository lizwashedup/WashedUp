-- ARCHIVED. NON-EXECUTABLE. PRESERVED WITH ITS SUPERSEDED STEP-2 SIBLING.
-- ============================================================================
-- S-03 co-creator role model, step 1 of 2: enum values only.
--
-- REVIEW ONLY. NOT applied anywhere -- sits in the repo until Josh applies it.
--
-- Spec source: WashedUp_Creator_Space_Complete_Inventory.md (Liz, 2026-08-18)
-- line 392-396: "Roles: Owner full; Admin except ownership transfer/bank;
-- Events event operations; Member care door/roster/room; Finance
-- orders/payouts." Full planning pass in the 2026-08-21 handoff.
--
-- Split into its own migration, isolated from every function/policy change
-- that reads these values: Postgres will not let a new enum label be USED
-- (as a literal, in a comparison, in a CHECK) in the same transaction that
-- ADDs it (the label is not visible to other statements until the adding
-- transaction commits -- this is a hard Postgres rule, not a house-style
-- choice). 20260821020000_community_role_tiers_capabilities.sql, which does
-- reference these four labels, must apply strictly after this file commits.
--
-- 'co_leader' is NOT touched or backfilled: it stays a permanent, live
-- synonym for the Admin tier below (same capability set, reached via
-- can_manage_* treating 'co_leader' and 'admin' identically). Every existing
-- co_leader row, RPC self-test fixture, and comment that assumes co_leader
-- keeps working unmodified. New invites/promotions go out as 'admin' from
-- here forward; nothing renames the old rows.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regtype('public.community_member_role') IS NULL THEN
    RAISE EXCEPTION 'S-03 dependency missing: public.community_member_role (20260702184012_communities_skeleton.sql) not present';
  END IF;
END $$;

ALTER TYPE public.community_member_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE public.community_member_role ADD VALUE IF NOT EXISTS 'events';
ALTER TYPE public.community_member_role ADD VALUE IF NOT EXISTS 'member_care';
ALTER TYPE public.community_member_role ADD VALUE IF NOT EXISTS 'finance';

COMMIT;
