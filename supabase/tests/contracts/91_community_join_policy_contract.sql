\set ON_ERROR_STOP on

DO $$
DECLARE
  v_cid uuid := '30000000-0000-0000-0000-000000000001';
  v_count integer;
  v_policy text;
  v_default text;
BEGIN
  -- This runs before any contract mutation and proves the migration itself did
  -- not choose a policy for, or rewrite, the five pre-existing rows.
  SELECT count(*) INTO v_count FROM public.communities
  WHERE id::text LIKE '30000000-0000-0000-0000-%' AND join_policy = 'open';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'community contract failed: migration rewrote existing rows';
  END IF;

  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'communities' AND column_name = 'join_policy';
  IF v_default IS DISTINCT FROM '''open''::text' THEN
    RAISE EXCEPTION 'community contract failed: default changed to %', v_default;
  END IF;

  IF has_function_privilege('anon', 'public.set_community_join_policy(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'community contract failed: anon has setter access';
  END IF;

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.set_community_join_policy(v_cid, 'open');
    RAISE EXCEPTION 'community contract failed: anon called policy setter';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- Admin and Member care roles can manage the join door under Liz's S-03
  -- permission model.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_community_join_policy(v_cid, 'approval_required');
  RESET ROLE;

  -- Co-leader is not one of the approved S-03 door-management roles.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.set_community_join_policy(v_cid, 'approval_required');
    RAISE EXCEPTION 'community contract failed: co-leader changed join policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_community_join_policy(v_cid, 'open');
  RESET ROLE;

  -- The Events role has no member-door permission and is denied.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.set_community_join_policy(v_cid, 'approval_required');
    RAISE EXCEPTION 'community contract failed: Events role changed join policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- A normal user with no Community role is denied as well. Use a newly added
  -- auth identity so the role matrix remains explicit.
  INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000005');
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.set_community_join_policy(v_cid, 'approval_required');
    RAISE EXCEPTION 'community contract failed: non-manager changed policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- Even the leader cannot bypass the RPC with a direct client UPDATE. Other
  -- Community fields remain writable through the existing RLS policy.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.communities SET join_policy = 'approval_required' WHERE id = v_cid;
    RAISE EXCEPTION 'community contract failed: direct policy UPDATE bypassed guard';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.communities SET name = 'Existing 1 renamed' WHERE id = v_cid;
  PERFORM public.set_community_join_policy(v_cid, 'approval_required');
  RESET ROLE;

  SELECT join_policy INTO v_policy FROM public.communities WHERE id = v_cid;
  IF v_policy <> 'approval_required' THEN
    RAISE EXCEPTION 'community contract failed: authorized setter did not persist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.communities WHERE id = v_cid AND name = 'Existing 1 renamed'
  ) THEN
    RAISE EXCEPTION 'community contract failed: guard blocked an unrelated field';
  END IF;

  -- The setter and table constraint both fail closed on an unapproved value.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.set_community_join_policy(v_cid, 'invite_only');
    RAISE EXCEPTION 'community contract failed: setter accepted a third policy';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  RESET ROLE;

  BEGIN
    INSERT INTO public.communities (handle, name, status, created_by, join_policy)
    VALUES (
      'invalid-policy', 'Invalid Policy', 'active',
      '00000000-0000-0000-0000-000000000001', 'invite_only'
    );
    RAISE EXCEPTION 'community contract failed: constraint accepted a third policy';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF to_regprocedure('public.request_to_join_community(uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'community contract fixture unexpectedly contains join RPC; narrow migration test is invalid';
  END IF;
END $$;

SELECT 'PASS: text join policy preserves five rows, restricts writes, and fails closed' AS result;
