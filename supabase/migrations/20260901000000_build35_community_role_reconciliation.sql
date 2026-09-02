-- DRAFT: DO NOT APPLY WITHOUT JOSH WORD
--
-- Build 35 / P3 batch A item A3: preserve every Community role assignment
-- against the PDF's authority taxonomy, before any permission code is written.
--
-- DRAFT: DO NOT APPLY WITHOUT JOSH'S WORD. Written for master plan v3 §5.1 A3
-- (clients/washed-up/specs/washedup-MASTER-PLAN-v3-20260831.md) and resolving
-- the Screen 41 "two live role taxonomies" conflict in
-- clients/washed-up/specs/washedup-BUILD35-DELTA-MATRIX-20260831.md.
--
-- Full mapping rationale, gap list, and the Screen 41 resolution:
-- clients/washed-up/specs/washedup-BUILD35-ROLE-RECONCILIATION-20260831.md
--
-- ---------------------------------------------------------------------------
-- SCOPE. Additive and reversible. Creates exactly one new table and reads
-- public.community_members to fill it. It does not alter, rename, or drop
-- community_members.role. It adds no column to any existing table. It changes
-- no RLS policy, no function, no grant on any existing object, and no existing
-- row. The single touch outside the new table is one foreign key on
-- community_members(id) with ON DELETE CASCADE, taken deliberately so a deleted
-- membership cannot leave an orphaned permission record behind.
--
-- No application code reads this table, so applying it cannot change any user's
-- effective permissions. That is the point of doing it in batch A.
--
-- ROLLBACK (one statement, deliberately not executable here):
--   DROP TABLE IF EXISTS public.community_role_assignments;
--
-- ---------------------------------------------------------------------------
-- LOAD-BEARING IMPLEMENTATION NOTE: every role comparison below goes through
-- role::text, never a bare enum literal.
--
-- public.community_member_role is live with exactly three labels
-- ('leader', 'co_leader', 'member'), created by
-- 20260702184012_communities_skeleton.sql and never extended: no
-- ALTER TYPE ... ADD VALUE for it exists anywhere in supabase/migrations/.
-- The four s03 tiers ('admin', 'events', 'member_care', 'finance') exist only
-- in lib/creatorMode.ts, because 20260821010000_community_role_tiers_enum.sql
-- was moved to docs/database/superseded-migrations/ by commit 4281ab8 and is
-- marked ARCHIVED / NON-EXECUTABLE.
--
-- Writing `role = 'events'` here would therefore raise 22P02 on the live
-- database and abort the apply. This is the same failure commit b99e369 fixed
-- on the client ("four labels that were never applied to the enum ... Postgres
-- threw 22P02 on every call"). The text comparisons below are correct on
-- today's three-label enum AND stay correct if the four labels are ever added.
--
-- Expected backfill on today's production: rows for 'leader' and 'co_leader'
-- only. The four tier branches are unreachable but written, so the mapping
-- rule is total rather than conditional on a schema question.
--
-- ---------------------------------------------------------------------------
-- Idempotent. Safe to re-run. Self-test at the end is read-only: it asserts
-- catalog shape and row counts and creates no transient application rows
-- (the reason 20260824190000 was archived).
-- ---------------------------------------------------------------------------

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.community_members') IS NULL THEN
    RAISE EXCEPTION 'A3 dependency missing: public.community_members (20260702184012_communities_skeleton.sql)';
  END IF;
  IF to_regtype('public.community_member_role') IS NULL THEN
    RAISE EXCEPTION 'A3 dependency missing: public.community_member_role (20260702184012_communities_skeleton.sql)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The reconciliation record.
--
-- Hybrid by design: an authority role AND its capability toggles, together.
-- A role alone cannot express the PDF's model (six of Co-lead's seven
-- capabilities are "if granted"); toggles alone lose the role name that
-- Screen 41 renders. Both halves are stored.
--
-- text + CHECK rather than a new enum: Postgres will not let a new enum label
-- be used in the same transaction that adds it, which is exactly why the s03
-- work had to be split across two files and why the half that landed alone had
-- to be archived. A text column with a CHECK has no cross-file ordering
-- dependency.
--
-- Absence of a row means plain Member, every capability false. Plain members
-- get no row: the table stays proportional to the delegate population, not the
-- whole membership base.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_role_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- one assignment per membership row. CASCADE so a deleted membership cannot
  -- strand a permission record.
  member_id     uuid NOT NULL UNIQUE
                  REFERENCES public.community_members(id) ON DELETE CASCADE,

  -- denormalised so "what may this user do in this community" needs no join.
  -- No FKs here on purpose: this migration adds exactly one constraint to one
  -- existing table (member_id above) and nothing to communities or auth.users.
  community_id  uuid NOT NULL,
  user_id       uuid NOT NULL,

  -- the PDF's Community taxonomy (Appendix C.10). 'chat_moderator' is a valid
  -- value with no source in the shipped model: this migration never produces
  -- one. Do not derive it from member_care.
  authority_role text NOT NULL
    CHECK (authority_role IN ('creator', 'co_lead', 'chat_moderator', 'member')),

  -- provenance: what this was derived from, and by which rule.
  source_role   public.community_member_role NOT NULL,
  derivation    text NOT NULL,

  -- the PDF's seven Community capabilities, in Appendix C.10 order.
  can_edit_community_profile  boolean NOT NULL DEFAULT false,
  can_review_join_requests    boolean NOT NULL DEFAULT false,
  can_broadcast_members       boolean NOT NULL DEFAULT false,
  can_configure_main_chat     boolean NOT NULL DEFAULT false,
  can_moderate_chat           boolean NOT NULL DEFAULT false,
  can_remove_members          boolean NOT NULL DEFAULT false,
  can_create_community_events boolean NOT NULL DEFAULT false,

  -- two capabilities the shipped tiers really hold that the PDF's seven do not
  -- name. Preserved so no shipped tier silently loses access.
  --   roster: the archived capabilities migration is explicit that the member
  --     management gate "doubles as the roster-VISIBILITY gate ... Member care
  --     cannot approve/decline what it cannot see".
  --   finance: the PDF has no Community finance capability at all; payouts live
  --     in the Organization matrix. This records the current fact until the
  --     Organization role system exists.
  can_view_member_roster      boolean NOT NULL DEFAULT false,
  can_view_community_finance  boolean NOT NULL DEFAULT false,

  -- the Organization-side role this assignment ALSO needs once master plan v3
  -- §5.1 A2 settles whether an Organization can hold a team. organizer_profiles
  -- is keyed user_id uuid primary key today, so an Organization is structurally
  -- one person and no Organization role can be written yet. NULL = none owed.
  -- Nothing is granted on the Organization side here, which is also the PDF's
  -- own Screen 41 acceptance criterion: no standalone event or payout
  -- permission is granted implicitly.
  pending_organization_role text
    CHECK (pending_organization_role IS NULL
           OR pending_organization_role IN ('event_manager', 'finance')),

  created_at timestamptz NOT NULL DEFAULT now(),

  -- a Creator can never be recorded with a missing capability. Machine-checked
  -- so a later migration cannot silently downgrade an owner.
  CONSTRAINT community_role_assignments_creator_is_full CHECK (
    authority_role <> 'creator' OR (
      can_edit_community_profile
      AND can_review_join_requests
      AND can_broadcast_members
      AND can_configure_main_chat
      AND can_moderate_chat
      AND can_remove_members
      AND can_create_community_events
    )
  )
);

COMMENT ON TABLE public.community_role_assignments IS
  'Build 35 A3 reconciliation record. Maps every non-member community_members.role assignment onto the PDF authority taxonomy (Creator/Co-lead/Chat moderator/Member) plus capability toggles. community_members.role is NOT modified and remains the navigation/shell axis (creatorShellKind, creatorLandingRoute); this table is the authority axis. Absence of a row means plain Member with every capability false. Not yet read by any application code. See clients/washed-up/specs/washedup-BUILD35-ROLE-RECONCILIATION-20260831.md.';

COMMENT ON COLUMN public.community_role_assignments.source_role IS
  'The community_members.role value this assignment was derived from. A value other than ''member'' means this person is a delegate, even where authority_role grants nothing (the finance case).';

COMMENT ON COLUMN public.community_role_assignments.pending_organization_role IS
  'Organization-side role still owed to this person, blocked on master plan v3 §5.1 A2. Not a grant.';

CREATE INDEX IF NOT EXISTS community_role_assignments_community_user_idx
  ON public.community_role_assignments (community_id, user_id);

CREATE INDEX IF NOT EXISTS community_role_assignments_pending_org_idx
  ON public.community_role_assignments (pending_organization_role)
  WHERE pending_organization_role IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Fail closed. RLS on with no policies, and no client grants: this record
--    must not be readable or writable from anon/authenticated. Contrast with
--    community_members, whose UPDATE policy is leader-scoped with no
--    column-level restriction -- a new column there would have been freely
--    writable by any leader. Build 35 permission code decides its own read
--    path later, deliberately, rather than inheriting one now.
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_role_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.community_role_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.community_role_assignments TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill. Every membership row whose role is not 'member' gets exactly one
--    assignment. ON CONFLICT DO NOTHING keeps a re-run inert and never
--    overwrites an assignment that Build 35 code may already have edited.
--
--    Mapping (see §3 of the reconciliation doc for the full reasoning):
--      leader      -> Creator, all seven. Clean 1:1.
--      co_leader   -> Co-lead, all seven ON. NOT a rename: co_leader is a full
--                     delegate today via is_community_leader(), and the PDF's
--                     Co-lead defaults to "if granted", so omitting the toggles
--                     would strip six capabilities from live co-leaders.
--      admin       -> identical to co_leader (the archived enum migration calls
--                     admin "the forward-facing name for the same capability
--                     set co_leader always had").
--      events      -> Co-lead, create-events only. Publish, ticketing,
--                     check-in, and attendee data are Organization-side in the
--                     PDF, so this row also owes an 'event_manager'
--                     Organization role. Real capability gap until A2.
--      member_care -> Co-lead with join review, remove members, moderate chat,
--                     plus roster visibility. NOT Chat moderator, which cannot
--                     review joins or remove members.
--      finance     -> Co-lead with ZERO PDF capabilities. The PDF's Community
--                     matrix has no finance capability at all. A Co-lead with
--                     no grants holds no authority under the PDF's own matrix,
--                     so this records "is a delegate" without granting
--                     anything, where 'member' would erase the fact. Owes a
--                     'finance' Organization role. Largest gap.
--      member      -> no row written.
-- ---------------------------------------------------------------------------

INSERT INTO public.community_role_assignments (
  member_id, community_id, user_id,
  authority_role, source_role, derivation,
  can_edit_community_profile, can_review_join_requests, can_broadcast_members,
  can_configure_main_chat, can_moderate_chat, can_remove_members,
  can_create_community_events,
  can_view_member_roster, can_view_community_finance,
  pending_organization_role
)
SELECT
  m.id,
  m.community_id,
  m.user_id,
  CASE WHEN m.role::text = 'leader' THEN 'creator' ELSE 'co_lead' END,
  m.role,
  'A3 backfill from community_members.role=' || m.role::text,

  m.role::text IN ('leader', 'co_leader', 'admin'),
  m.role::text IN ('leader', 'co_leader', 'admin', 'member_care'),
  m.role::text IN ('leader', 'co_leader', 'admin'),
  m.role::text IN ('leader', 'co_leader', 'admin'),
  m.role::text IN ('leader', 'co_leader', 'admin', 'member_care'),
  m.role::text IN ('leader', 'co_leader', 'admin', 'member_care'),
  m.role::text IN ('leader', 'co_leader', 'admin', 'events'),

  m.role::text IN ('leader', 'co_leader', 'admin', 'member_care'),
  m.role::text IN ('leader', 'co_leader', 'admin', 'finance'),

  CASE m.role::text
    WHEN 'events'  THEN 'event_manager'
    WHEN 'finance' THEN 'finance'
    ELSE NULL
  END
FROM public.community_members m
WHERE m.role::text <> 'member'
ON CONFLICT (member_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Read-only self-test. Catalog and count assertions only: no application
--    rows are created, updated, or deleted.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_delegates    bigint;
  v_assignments  bigint;
  v_orphans      bigint;
  v_weak_creator bigint;
  v_labels       text;
BEGIN
  SELECT count(*) INTO v_delegates
    FROM public.community_members WHERE role::text <> 'member';
  SELECT count(*) INTO v_assignments
    FROM public.community_role_assignments;

  IF v_assignments <> v_delegates THEN
    RAISE EXCEPTION 'A3 self-test: % delegate rows but % assignments', v_delegates, v_assignments;
  END IF;

  -- every delegate is covered
  SELECT count(*) INTO v_orphans
    FROM public.community_members m
    LEFT JOIN public.community_role_assignments a ON a.member_id = m.id
   WHERE m.role::text <> 'member' AND a.id IS NULL;
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION 'A3 self-test: % delegate rows have no assignment', v_orphans;
  END IF;

  -- no owner lost anything
  SELECT count(*) INTO v_weak_creator
    FROM public.community_role_assignments
   WHERE source_role::text = 'leader'
     AND (authority_role <> 'creator' OR NOT can_view_member_roster OR NOT can_view_community_finance);
  IF v_weak_creator <> 0 THEN
    RAISE EXCEPTION 'A3 self-test: % leader rows mapped to a reduced Creator', v_weak_creator;
  END IF;

  -- record what the live enum actually held at apply time, for the audit trail
  SELECT string_agg(enumlabel::text, ',' ORDER BY enumsortorder) INTO v_labels
    FROM pg_enum WHERE enumtypid = 'public.community_member_role'::regtype;
  RAISE NOTICE 'A3: community_member_role labels at apply time = [%]', v_labels;
  RAISE NOTICE 'A3: preserved % delegate assignments, % pending Organization roles',
    v_assignments,
    (SELECT count(*) FROM public.community_role_assignments WHERE pending_organization_role IS NOT NULL);
END $$;

COMMIT;
