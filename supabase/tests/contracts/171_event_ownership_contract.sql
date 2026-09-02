\set ON_ERROR_STOP on

-- Contract for Build 35 A1 (event ownership). Runs after
-- 170_event_ownership_fixture.sql and the real migration
-- 20260901010000_build35_event_ownership.sql have both applied.
--
-- Covers exactly the gap the spec names in its own §8/§6: the migration's
-- internal self-test is read-only (asserts against rows already in the
-- table), and deliberately does NOT exercise the insert trigger, the update
-- trigger, or either cascade path, because doing that inside a production
-- migration would fire explore_events' OTHER triggers against live data.
-- This file is free to do all of that, because it only ever runs against
-- the disposable contract database.

DO $$
DECLARE
  v_count       bigint;
  v_owner_type  text;
  v_owner_user  uuid;
  v_owner_comm  uuid;
  v_owner_id    uuid;
  v_audit_count bigint;
  v_reason      text;
  v_committed   boolean;
  v_sqlstate    text;
BEGIN
  ------------------------------------------------------------------------
  -- Backfill correctness on all nine pre-existing rows (independent of the
  -- migration's own self-test -- this is a second, external witness).
  ------------------------------------------------------------------------
  SELECT owner_type, owner_user_id, owner_community_id, owner_id
    INTO v_owner_type, v_owner_user, v_owner_comm, v_owner_id
    FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000001';
  IF v_owner_type <> 'community' OR v_owner_comm IS DISTINCT FROM '40000000-0000-0000-0000-000000000001'::uuid
     OR v_owner_user IS NOT NULL OR v_owner_id IS DISTINCT FROM v_owner_comm THEN
    RAISE EXCEPTION 'A1 contract: community-first precedence failed for event 1 (owner_type=%, owner_user_id=%, owner_community_id=%)', v_owner_type, v_owner_user, v_owner_comm;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000001' AND host_user_id = '00000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'A1 contract: host_user_id was not preserved as creator attribution on event 1';
  END IF;

  SELECT owner_type INTO v_owner_type FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000002';
  IF v_owner_type <> 'organization' THEN
    RAISE EXCEPTION 'A1 contract: host-only event 2 backfilled to % instead of organization', v_owner_type;
  END IF;

  SELECT owner_type INTO v_owner_type FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000003';
  IF v_owner_type <> 'platform' THEN
    RAISE EXCEPTION 'A1 contract: admin-curated event 3 backfilled to % instead of platform', v_owner_type;
  END IF;

  ------------------------------------------------------------------------
  -- T1-T3: the BEFORE INSERT trigger derives ownership on brand-new rows,
  -- using the same precedence as the backfill. This is the path the
  -- migration's own self-test explicitly does not exercise.
  ------------------------------------------------------------------------
  INSERT INTO public.explore_events (id, title, host_user_id, community_id)
  VALUES ('50000000-0000-0000-0000-0000000000a1', 'New community event', '00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');
  SELECT owner_type, owner_user_id, owner_community_id, owner_id
    INTO v_owner_type, v_owner_user, v_owner_comm, v_owner_id
    FROM public.explore_events WHERE id = '50000000-0000-0000-0000-0000000000a1';
  IF v_owner_type <> 'community' OR v_owner_comm IS DISTINCT FROM '40000000-0000-0000-0000-000000000001'::uuid OR v_owner_user IS NOT NULL THEN
    RAISE EXCEPTION 'A1 contract T1: new community-owned insert derived owner_type=%, owner_user_id=%, owner_community_id=%', v_owner_type, v_owner_user, v_owner_comm;
  END IF;

  INSERT INTO public.explore_events (id, title, host_user_id, community_id)
  VALUES ('50000000-0000-0000-0000-0000000000a2', 'New solo event', '00000000-0000-0000-0000-000000000002', NULL);
  SELECT owner_type, owner_user_id, owner_community_id INTO v_owner_type, v_owner_user, v_owner_comm
    FROM public.explore_events WHERE id = '50000000-0000-0000-0000-0000000000a2';
  IF v_owner_type <> 'organization' OR v_owner_user IS DISTINCT FROM '00000000-0000-0000-0000-000000000002'::uuid OR v_owner_comm IS NOT NULL THEN
    RAISE EXCEPTION 'A1 contract T2: new organization-owned insert derived owner_type=%, owner_user_id=%, owner_community_id=%', v_owner_type, v_owner_user, v_owner_comm;
  END IF;

  INSERT INTO public.explore_events (id, title, host_user_id, community_id)
  VALUES ('50000000-0000-0000-0000-0000000000a3', 'New admin listing', NULL, NULL);
  SELECT owner_type, owner_user_id, owner_community_id, owner_id INTO v_owner_type, v_owner_user, v_owner_comm, v_owner_id
    FROM public.explore_events WHERE id = '50000000-0000-0000-0000-0000000000a3';
  IF v_owner_type <> 'platform' OR v_owner_user IS NOT NULL OR v_owner_comm IS NOT NULL OR v_owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A1 contract T3: new platform insert derived owner_type=%, owner_id=%', v_owner_type, v_owner_id;
  END IF;

  -- Build 35 code that sets ownership explicitly on INSERT is left alone by
  -- the trigger (IF NEW.owner_type IS NOT NULL THEN RETURN NEW).
  INSERT INTO public.explore_events (id, title, host_user_id, community_id, owner_type, owner_user_id, owner_community_id)
  VALUES ('50000000-0000-0000-0000-0000000000a4', 'Explicit owner insert', '00000000-0000-0000-0000-000000000001', NULL, 'organization', '00000000-0000-0000-0000-000000000001', NULL);
  SELECT owner_type INTO v_owner_type FROM public.explore_events WHERE id = '50000000-0000-0000-0000-0000000000a4';
  IF v_owner_type <> 'organization' THEN
    RAISE EXCEPTION 'A1 contract: explicit-owner insert was overridden by the derive trigger (got %)', v_owner_type;
  END IF;

  ------------------------------------------------------------------------
  -- T4 / invariant 1: no event can carry two owners at once. Use event 6,
  -- which has no committed guests, to isolate the CHECK from invariant 2.
  ------------------------------------------------------------------------
  SELECT count(*) INTO v_audit_count FROM public.event_owner_changes;
  BEGIN
    UPDATE public.explore_events
       SET owner_type = 'organization', owner_user_id = '00000000-0000-0000-0000-000000000001',
           owner_community_id = '40000000-0000-0000-0000-000000000001'
     WHERE id = '50000000-0000-0000-0000-000000000006';
    RAISE EXCEPTION 'A1 contract T4: two-owner update was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.event_owner_changes) <> v_audit_count THEN
    RAISE EXCEPTION 'A1 contract T4: a failed CHECK still left an audit row behind';
  END IF;

  ------------------------------------------------------------------------
  -- T5: owner_id is GENERATED ALWAYS and cannot be written directly, on
  -- any role, not even a superuser. SQLSTATE 428C9 = generated_always,
  -- confirmed live against Postgres 17 by this session before this file
  -- was written (not assumed from documentation).
  ------------------------------------------------------------------------
  BEGIN
    UPDATE public.explore_events SET owner_id = gen_random_uuid() WHERE id = '50000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'A1 contract T5: owner_id accepted a direct write';
  EXCEPTION WHEN SQLSTATE '428C9' THEN NULL;
  END;

  ------------------------------------------------------------------------
  -- D4: an invalid owner_type is rejected by event_owner_type_valid.
  ------------------------------------------------------------------------
  BEGIN
    UPDATE public.explore_events SET owner_type = 'admin' WHERE id = '50000000-0000-0000-0000-000000000006';
    RAISE EXCEPTION 'A1 contract D4: an invalid owner_type was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  ------------------------------------------------------------------------
  -- T6/T7/T8: invariant 2. Event 4 has a paid order; event 5 has only an
  -- active RSVP (both must count as "committed"); event 6 has neither.
  ------------------------------------------------------------------------

  -- T6: implicit change on a paid event raises, and rolls back cleanly
  -- (verified by re-reading the row after the exception).
  BEGIN
    UPDATE public.explore_events SET owner_type = 'platform', owner_user_id = NULL, owner_community_id = NULL
     WHERE id = '50000000-0000-0000-0000-000000000004';
    RAISE EXCEPTION 'A1 contract T6: implicit owner change on a paid event was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT owner_type INTO v_owner_type FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000004';
  IF v_owner_type <> 'organization' THEN
    RAISE EXCEPTION 'A1 contract T6: the rejected update still moved the owner (now %)', v_owner_type;
  END IF;

  -- Same on event 5, which has an RSVP but no paid order: still committed.
  BEGIN
    UPDATE public.explore_events SET owner_type = 'platform', owner_user_id = NULL, owner_community_id = NULL
     WHERE id = '50000000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'A1 contract T6b: implicit owner change on an RSVP-only event was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- T7: the same change, with a declared reason, succeeds and is audited
  -- with had_committed_guests = true.
  PERFORM set_config('washedup.owner_change_reason', 'transfer approved by Liz, contract T7', true);
  UPDATE public.explore_events SET owner_type = 'platform', owner_user_id = NULL, owner_community_id = NULL
   WHERE id = '50000000-0000-0000-0000-000000000004';
  SELECT reason, had_committed_guests INTO v_reason, v_committed
    FROM public.event_owner_changes
   WHERE event_id = '50000000-0000-0000-0000-000000000004'
   ORDER BY changed_at DESC LIMIT 1;
  IF v_reason <> 'transfer approved by Liz, contract T7' OR v_committed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A1 contract T7: declared-reason change audited as reason=%, had_committed_guests=%', v_reason, v_committed;
  END IF;
  -- set_config(..., true) is transaction-local, and this whole contract runs
  -- as one transaction (one top-level DO block): clear it explicitly so T8
  -- below is not audited under T7's leftover reason.
  PERFORM set_config('washedup.owner_change_reason', '', true);

  -- T8: a change on event 6 (no guests, no reason) is allowed AND audited,
  -- with the fixed "unspecified" reason -- invariant 10 is unconditional
  -- even though invariant 2's gate is not triggered.
  UPDATE public.explore_events SET owner_type = 'platform', owner_user_id = NULL, owner_community_id = NULL
   WHERE id = '50000000-0000-0000-0000-000000000006';
  SELECT reason, had_committed_guests INTO v_reason, v_committed
    FROM public.event_owner_changes
   WHERE event_id = '50000000-0000-0000-0000-000000000006'
   ORDER BY changed_at DESC LIMIT 1;
  IF v_reason <> 'unspecified: no committed guests at change time' OR v_committed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A1 contract T8: no-guest change audited as reason=%, had_committed_guests=%', v_reason, v_committed;
  END IF;

  ------------------------------------------------------------------------
  -- R2-R4: ordinary edits to columns outside the trigger's watch list never
  -- fire the guard, even on a sold/RSVP'd event, and never write an audit
  -- row -- including a blanket UPDATE that touches every row in the table.
  ------------------------------------------------------------------------
  SELECT count(*) INTO v_audit_count FROM public.event_owner_changes;
  UPDATE public.explore_events SET title = 'Sold-out paint night (renamed)' WHERE id = '50000000-0000-0000-0000-000000000004';
  UPDATE public.explore_events SET status = status; -- touches every row in the table
  IF (SELECT count(*) FROM public.event_owner_changes) <> v_audit_count THEN
    RAISE EXCEPTION 'A1 contract R2-R4: an edit outside the owner-column watch list still wrote an audit row';
  END IF;

  ------------------------------------------------------------------------
  -- D2: writing the legacy community_id column alone (no owner column in
  -- the SET list) fires the trigger's column watch, but the owner columns
  -- are unchanged, so the early-return applies: no error, owner unmoved,
  -- no audit row. Matches §5.1's accepted consequence exactly.
  ------------------------------------------------------------------------
  SELECT count(*) INTO v_audit_count FROM public.event_owner_changes;
  UPDATE public.explore_events SET community_id = '40000000-0000-0000-0000-000000000001'
   WHERE id = '50000000-0000-0000-0000-000000000002';
  SELECT owner_type INTO v_owner_type FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000002';
  IF v_owner_type <> 'organization' THEN
    RAISE EXCEPTION 'A1 contract D2: a legacy community_id write alone moved ownership to %', v_owner_type;
  END IF;
  IF (SELECT count(*) FROM public.event_owner_changes) <> v_audit_count THEN
    RAISE EXCEPTION 'A1 contract D2: a legacy community_id write alone wrote an audit row';
  END IF;
  -- restore, so it does not confuse the delete-cascade section below
  UPDATE public.explore_events SET community_id = NULL WHERE id = '50000000-0000-0000-0000-000000000002';

  ------------------------------------------------------------------------
  -- T9 / R2 cascade: deleting Community B re-homes both of its events --
  -- to organization when a host is still present (event 7), to platform
  -- when it is not (event 8) -- and each cascade writes exactly one
  -- "automatic:" audit row (verified above that no other trigger on this
  -- table touches the owner columns, so a double-fire cannot double-audit).
  ------------------------------------------------------------------------
  DELETE FROM public.communities WHERE id = '40000000-0000-0000-0000-000000000002';

  SELECT owner_type, owner_user_id INTO v_owner_type, v_owner_user
    FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000007';
  IF v_owner_type <> 'organization' OR v_owner_user IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'A1 contract T9: event 7 re-homed to owner_type=%, owner_user_id=% instead of organization/host', v_owner_type, v_owner_user;
  END IF;
  SELECT count(*) INTO v_count FROM public.event_owner_changes
   WHERE event_id = '50000000-0000-0000-0000-000000000007' AND reason = 'automatic: owning community deleted, event re-homed';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A1 contract T9: event 7 cascade produced % automatic audit row(s), expected exactly 1', v_count;
  END IF;

  SELECT owner_type INTO v_owner_type FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000008';
  IF v_owner_type <> 'platform' THEN
    RAISE EXCEPTION 'A1 contract T9: hostless event 8 re-homed to % instead of platform', v_owner_type;
  END IF;
  SELECT count(*) INTO v_count FROM public.event_owner_changes
   WHERE event_id = '50000000-0000-0000-0000-000000000008' AND reason = 'automatic: owning community deleted, event re-homed';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A1 contract T9: event 8 cascade produced % automatic audit row(s), expected exactly 1', v_count;
  END IF;

  IF EXISTS (SELECT 1 FROM public.communities WHERE id = '40000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'A1 contract T9: the community delete did not actually happen';
  END IF;

  ------------------------------------------------------------------------
  -- R7 cascade: deleting the sole owning user re-homes to platform, with
  -- its own "automatic:" reason text.
  ------------------------------------------------------------------------
  DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000003';
  SELECT owner_type INTO v_owner_type FROM public.explore_events WHERE id = '50000000-0000-0000-0000-000000000009';
  IF v_owner_type <> 'platform' THEN
    RAISE EXCEPTION 'A1 contract R7: event 9 re-homed to % instead of platform after its owning user was deleted', v_owner_type;
  END IF;
  SELECT count(*) INTO v_count FROM public.event_owner_changes
   WHERE event_id = '50000000-0000-0000-0000-000000000009' AND reason = 'automatic: owning user deleted, event re-homed to platform';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A1 contract R7: event 9 cascade produced % automatic audit row(s), expected exactly 1', v_count;
  END IF;

  ------------------------------------------------------------------------
  -- Fail-closed audit table, re-checked independently of the migration's
  -- own self-test.
  ------------------------------------------------------------------------
  IF has_table_privilege('authenticated', 'public.event_owner_changes', 'SELECT')
     OR has_table_privilege('anon', 'public.event_owner_changes', 'SELECT') THEN
    RAISE EXCEPTION 'A1 contract: event_owner_changes is readable by a client role';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.event_owner_changes', 'SELECT') THEN
    RAISE EXCEPTION 'A1 contract: service_role lost SELECT on event_owner_changes';
  END IF;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.event_owner_changes LIMIT 1;
    RAISE EXCEPTION 'A1 contract: authenticated could read event_owner_changes';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  ------------------------------------------------------------------------
  -- D5: final sweep. Every row has exactly one owner and an owner_id that
  -- agrees with the typed columns; nothing was ever deleted from
  -- explore_events itself (13 = 9 original + 4 new inserts).
  ------------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM public.explore_events;
  IF v_count <> 13 THEN
    RAISE EXCEPTION 'A1 contract D5: expected 13 explore_events rows, found %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.explore_events WHERE owner_type IS NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'A1 contract D5: % rows have no owner_type', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.explore_events WHERE owner_user_id IS NOT NULL AND owner_community_id IS NOT NULL;
  IF v_count <> 0 THEN RAISE EXCEPTION 'A1 contract D5: % rows carry two owners', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.explore_events WHERE owner_id IS DISTINCT FROM COALESCE(owner_user_id, owner_community_id);
  IF v_count <> 0 THEN RAISE EXCEPTION 'A1 contract D5: % rows have a mismatched owner_id', v_count; END IF;
END $$;

SELECT 'PASS: A1 event ownership -- backfill, insert derivation, one-owner CHECK, owner_id immutability, invariant 2 raise/audit, both cascade re-homes, and the ordinary-edit regression all hold' AS result;
