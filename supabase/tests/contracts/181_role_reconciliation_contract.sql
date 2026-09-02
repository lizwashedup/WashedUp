\set ON_ERROR_STOP on

-- Contract for Build 35 A3 (community role reconciliation). Runs after
-- 180_role_reconciliation_fixture.sql and the real migration
-- 20260901000000_build35_community_role_reconciliation.sql have both
-- applied against the widened (8-row) fixture. Checks every row of the
-- mapping table in
-- clients/washed-up/specs/washedup-BUILD35-ROLE-RECONCILIATION-20260831.md
-- §3.9, not just the two labels real production can currently store.

DO $$
DECLARE
  v_count  bigint;
  v_role   text;
  v_pending text;
BEGIN
  ------------------------------------------------------------------------
  -- Row accounting: exactly one assignment per non-member row (7 of the 8
  -- fixture rows), and the plain member gets none.
  ------------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM public.community_role_assignments;
  IF v_count <> 7 THEN
    RAISE EXCEPTION 'A3 contract: expected 7 assignments for 7 non-member rows, found %', v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_role_assignments
     WHERE member_id = '60000000-0000-0000-0000-000000000003'
  ) THEN
    RAISE EXCEPTION 'A3 contract: a plain member got an assignment row';
  END IF;

  ------------------------------------------------------------------------
  -- leader -> Creator, all seven PDF capabilities, plus both non-PDF
  -- toggles (roster, finance). Clean 1:1, per §3.1.
  ------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.community_role_assignments
     WHERE member_id = '60000000-0000-0000-0000-000000000001'
       AND authority_role = 'creator'
       AND can_edit_community_profile AND can_review_join_requests AND can_broadcast_members
       AND can_configure_main_chat AND can_moderate_chat AND can_remove_members
       AND can_create_community_events AND can_view_member_roster AND can_view_community_finance
       AND pending_organization_role IS NULL
       AND source_role::text = 'leader'
  ) THEN
    RAISE EXCEPTION 'A3 contract: leader did not map to a full Creator';
  END IF;

  ------------------------------------------------------------------------
  -- co_leader -> Co-lead, ALL SEVEN toggles ON (not a weaker mapping -- see
  -- §3.2, the highest-risk row in the whole reconciliation). Both fixture
  -- co_leader rows (member 2 and member 4) must match identically.
  ------------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM public.community_role_assignments
   WHERE member_id IN ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000004')
     AND authority_role = 'co_lead'
     AND can_edit_community_profile AND can_review_join_requests AND can_broadcast_members
     AND can_configure_main_chat AND can_moderate_chat AND can_remove_members
     AND can_create_community_events AND can_view_member_roster AND can_view_community_finance
     AND pending_organization_role IS NULL
     AND source_role::text = 'co_leader';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'A3 contract: expected both co_leader rows mapped to a full Co-lead, matched %', v_count;
  END IF;

  ------------------------------------------------------------------------
  -- admin -> identical to co_leader (§3.3): same authority_role, same
  -- seven-toggle shape, same two non-PDF toggles, no pending role.
  ------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.community_role_assignments
     WHERE member_id = '60000000-0000-0000-0000-000000000005'
       AND authority_role = 'co_lead'
       AND can_edit_community_profile AND can_review_join_requests AND can_broadcast_members
       AND can_configure_main_chat AND can_moderate_chat AND can_remove_members
       AND can_create_community_events AND can_view_member_roster AND can_view_community_finance
       AND pending_organization_role IS NULL
       AND source_role::text = 'admin'
  ) THEN
    RAISE EXCEPTION 'A3 contract: admin did not map identically to co_leader';
  END IF;

  ------------------------------------------------------------------------
  -- events -> Co-lead, ONLY create-events granted; everything else false,
  -- including both non-PDF toggles; owes pending_organization_role =
  -- 'event_manager'. The real capability gap named in §3.4.
  ------------------------------------------------------------------------
  SELECT pending_organization_role INTO v_pending FROM public.community_role_assignments
   WHERE member_id = '60000000-0000-0000-0000-000000000006';
  IF NOT EXISTS (
    SELECT 1 FROM public.community_role_assignments
     WHERE member_id = '60000000-0000-0000-0000-000000000006'
       AND authority_role = 'co_lead'
       AND can_create_community_events
       AND NOT can_edit_community_profile AND NOT can_review_join_requests AND NOT can_broadcast_members
       AND NOT can_configure_main_chat AND NOT can_moderate_chat AND NOT can_remove_members
       AND NOT can_view_member_roster AND NOT can_view_community_finance
       AND source_role::text = 'events'
  ) OR v_pending <> 'event_manager' THEN
    RAISE EXCEPTION 'A3 contract: events tier did not map to create-events-only with pending_organization_role=event_manager (got %)', v_pending;
  END IF;

  ------------------------------------------------------------------------
  -- member_care -> Co-lead with join review, remove members, moderate
  -- chat, plus roster visibility. NOT Chat moderator. No pending role.
  -- Per §3.5.
  ------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM public.community_role_assignments
     WHERE member_id = '60000000-0000-0000-0000-000000000007'
       AND authority_role = 'co_lead'
       AND can_review_join_requests AND can_moderate_chat AND can_remove_members AND can_view_member_roster
       AND NOT can_edit_community_profile AND NOT can_broadcast_members AND NOT can_configure_main_chat
       AND NOT can_create_community_events AND NOT can_view_community_finance
       AND pending_organization_role IS NULL
       AND source_role::text = 'member_care'
  ) THEN
    RAISE EXCEPTION 'A3 contract: member_care tier did not map to the join-review/remove/moderate/roster shape';
  END IF;

  ------------------------------------------------------------------------
  -- finance -> Co-lead with ZERO PDF capabilities, can_view_community_
  -- finance = true, pending_organization_role = 'finance'. The largest gap
  -- (§3.6): a delegate is recorded, but the PDF grants it no authority.
  ------------------------------------------------------------------------
  SELECT pending_organization_role INTO v_pending FROM public.community_role_assignments
   WHERE member_id = '60000000-0000-0000-0000-000000000008';
  IF NOT EXISTS (
    SELECT 1 FROM public.community_role_assignments
     WHERE member_id = '60000000-0000-0000-0000-000000000008'
       AND authority_role = 'co_lead'
       AND NOT can_edit_community_profile AND NOT can_review_join_requests AND NOT can_broadcast_members
       AND NOT can_configure_main_chat AND NOT can_moderate_chat AND NOT can_remove_members
       AND NOT can_create_community_events AND NOT can_view_member_roster
       AND can_view_community_finance
       AND source_role::text = 'finance'
  ) OR v_pending <> 'finance' THEN
    RAISE EXCEPTION 'A3 contract: finance tier did not map to zero-PDF-capability-plus-finance-toggle with pending_organization_role=finance (got %)', v_pending;
  END IF;

  ------------------------------------------------------------------------
  -- community_role_assignments_creator_is_full: a Creator can never be
  -- recorded with a missing PDF capability, even by a hand-written INSERT
  -- outside the migration's own backfill.
  ------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.community_role_assignments (
      member_id, community_id, user_id, authority_role, source_role, derivation,
      can_edit_community_profile, can_review_join_requests, can_broadcast_members,
      can_configure_main_chat, can_moderate_chat, can_remove_members, can_create_community_events
    ) VALUES (
      '60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003',
      'creator', 'leader', 'contract probe: weak creator',
      true, true, true, true, true, true, false  -- can_create_community_events withheld
    );
    RAISE EXCEPTION 'A3 contract: a Creator with a withheld PDF capability was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  ------------------------------------------------------------------------
  -- authority_role and pending_organization_role CHECK constraints reject
  -- values outside the PDF taxonomy.
  ------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.community_role_assignments (member_id, community_id, user_id, authority_role, source_role, derivation)
    VALUES ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'owner', 'leader', 'contract probe: bad authority_role');
    RAISE EXCEPTION 'A3 contract: an invalid authority_role was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.community_role_assignments (member_id, community_id, user_id, authority_role, source_role, derivation, pending_organization_role)
    VALUES ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'member', 'leader', 'contract probe: bad pending role', 'owner');
    RAISE EXCEPTION 'A3 contract: an invalid pending_organization_role was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  ------------------------------------------------------------------------
  -- member_id is UNIQUE: a second assignment for an already-assigned
  -- member is rejected, matching "one assignment per membership row".
  ------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.community_role_assignments (member_id, community_id, user_id, authority_role, source_role, derivation)
    VALUES ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'member', 'leader', 'contract probe: duplicate member_id');
    RAISE EXCEPTION 'A3 contract: a second assignment for the same member_id was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  ------------------------------------------------------------------------
  -- Fail-closed: RLS enabled, zero policies, no anon/authenticated grants,
  -- service_role can SELECT.
  ------------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.community_role_assignments'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'A3 contract: community_role_assignments does not have RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'community_role_assignments') THEN
    RAISE EXCEPTION 'A3 contract: community_role_assignments has a policy (must be service-only)';
  END IF;
  IF has_table_privilege('authenticated', 'public.community_role_assignments', 'SELECT')
     OR has_table_privilege('anon', 'public.community_role_assignments', 'SELECT') THEN
    RAISE EXCEPTION 'A3 contract: community_role_assignments is readable by a client role';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.community_role_assignments', 'SELECT') THEN
    RAISE EXCEPTION 'A3 contract: service_role lost SELECT on community_role_assignments';
  END IF;

  ------------------------------------------------------------------------
  -- community_members.role itself is completely untouched: still the same
  -- column, same type, same values, per the migration's own scope note.
  ------------------------------------------------------------------------
  SELECT role::text INTO v_role FROM public.community_members WHERE id = '60000000-0000-0000-0000-000000000001';
  IF v_role <> 'leader' THEN
    RAISE EXCEPTION 'A3 contract: community_members.role was modified (member 1 now %)', v_role;
  END IF;
END $$;

SELECT 'PASS: A3 role reconciliation -- all seven shipped tiers map per §3.9, Creator integrity and taxonomy CHECKs hold, and the record is fail-closed' AS result;
