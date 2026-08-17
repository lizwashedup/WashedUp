\set ON_ERROR_STOP on

-- Run after 50_people_dm_fixture.sql and the R02 forward migration.

DO $$
DECLARE
  v_dm uuid;
  v_same uuid;
  v_reverse uuid;
  v_count integer;
BEGIN
  -- A and B are unrelated. An authenticated caller cannot create a DM yet.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  BEGIN
    PERFORM public.get_or_create_dm('00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'R02 contract failed: unrelated pair created a DM';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT count(*) INTO v_count FROM public.circles;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'R02 contract failed: denied call left % circle rows', v_count;
  END IF;

  -- One accepted directional row makes the relationship mutual for this gate.
  INSERT INTO public.people_connections
    (requester_user_id, recipient_user_id, status, context, responded_at)
  VALUES
    ('00000000-0000-0000-0000-000000000001',
     '00000000-0000-0000-0000-000000000002',
     'accepted', 'handle_lookup', now());

  v_dm := public.get_or_create_dm('00000000-0000-0000-0000-000000000002');
  v_same := public.get_or_create_dm('00000000-0000-0000-0000-000000000002');

  IF v_dm IS NULL OR v_same IS DISTINCT FROM v_dm THEN
    RAISE EXCEPTION 'R02 contract failed: accepted-pair DM is not idempotent';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.circle_members
  WHERE circle_id = v_dm AND status = 'joined';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'R02 contract failed: expected two joined DM members, got %', v_count;
  END IF;

  -- The reverse caller resolves the same unordered pair.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  v_reverse := public.get_or_create_dm('00000000-0000-0000-0000-000000000001');
  IF v_reverse IS DISTINCT FROM v_dm THEN
    RAISE EXCEPTION 'R02 contract failed: reverse caller got a different DM';
  END IF;

  -- An unrelated third person still cannot open a DM with either member.
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  BEGIN
    PERFORM public.get_or_create_dm('00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'R02 contract failed: third person created a DM';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- Blocking closes access even when the accepted relationship and DM exist.
  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES ('00000000-0000-0000-0000-000000000002',
          '00000000-0000-0000-0000-000000000001');

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  BEGIN
    PERFORM public.get_or_create_dm('00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'R02 contract failed: blocked accepted pair reopened a DM';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

-- RLS probe under the actual authenticated role. Person C is not a member and
-- must not see either the DM row or its roster.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
DO $$
DECLARE
  v_visible integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.circles)
    + (SELECT count(*) FROM public.circle_members)
  INTO v_visible;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'R02 contract failed: unrelated caller can read % protected rows', v_visible;
  END IF;
END $$;
RESET ROLE;

SELECT 'PASS R02: DMs require an accepted, unblocked Your People relationship' AS result;
