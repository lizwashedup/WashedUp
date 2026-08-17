-- REVIEW ONLY. Forward migration. Do not apply without explicit approval.
--
-- R02: a direct-message circle may only be opened for an accepted Your People
-- relationship. This replaces the latest checked-in get_or_create_dm body from
-- 20260609000000_get_or_create_dm_lock.sql and preserves its signature, block
-- guard, pair-scoped advisory lock, dedupe behavior, grants, and existing table
-- columns.
--
-- Source-supported assumptions:
--   * public.yours_is_connected(uuid, uuid) returns true for an accepted
--     people_connections row in either direction.
--   * public.yours_is_blocked_between(uuid, uuid) checks both block stores.
--   * public.circles and public.circle_members have the columns used below.
--
-- No co-attendance requirement is added. An accepted relationship can be an
-- honest mutual attestation of an off-app real-life meeting.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.yours_is_connected(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'R02 dependency missing: public.yours_is_connected(uuid,uuid)';
  END IF;
  IF to_regprocedure('public.yours_is_blocked_between(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'R02 dependency missing: public.yours_is_blocked_between(uuid,uuid)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_or_create_dm(p_other uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_circle uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_other IS NULL OR p_other = v_me THEN
    RAISE EXCEPTION 'invalid DM target' USING ERRCODE = '22023';
  END IF;
  IF public.yours_is_blocked_between(v_me, p_other) THEN
    RAISE EXCEPTION 'blocked' USING ERRCODE = '42501';
  END IF;
  IF NOT public.yours_is_connected(v_me, p_other) THEN
    RAISE EXCEPTION 'accepted relationship required' USING ERRCODE = '42501';
  END IF;

  -- Serialize per unordered pair so concurrent callers cannot create two DMs.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      least(v_me::text, p_other::text) || '|' || greatest(v_me::text, p_other::text),
      0
    )
  );

  -- Reuse the oldest unnamed two-person circle for this exact pair. A former
  -- DM that grew to three or more joined members no longer matches.
  SELECT c.id INTO v_circle
  FROM public.circles c
  WHERE c.name = ''
    AND (SELECT count(*)
         FROM public.circle_members m
         WHERE m.circle_id = c.id AND m.status = 'joined') = 2
    AND EXISTS (
      SELECT 1 FROM public.circle_members m
      WHERE m.circle_id = c.id
        AND m.user_id = v_me
        AND m.status = 'joined'
    )
    AND EXISTS (
      SELECT 1 FROM public.circle_members m
      WHERE m.circle_id = c.id
        AND m.user_id = p_other
        AND m.status = 'joined'
    )
  ORDER BY c.created_at
  LIMIT 1;

  IF v_circle IS NOT NULL THEN
    RETURN v_circle;
  END IF;

  INSERT INTO public.circles (name, description, creator_user_id)
  VALUES ('', NULL, v_me)
  RETURNING id INTO v_circle;

  INSERT INTO public.circle_members (circle_id, user_id, role, status)
  VALUES (v_circle, v_me,    'admin', 'joined'),
         (v_circle, p_other, 'admin', 'joined');

  RETURN v_circle;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_or_create_dm(uuid)'::regprocedure)
  INTO v_definition;

  IF v_definition IS NULL
     OR position('SECURITY DEFINER' IN upper(v_definition)) = 0
     OR position('yours_is_connected' IN v_definition) = 0
     OR position('pg_advisory_xact_lock' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'R02 self-test failed: guarded, locked get_or_create_dm definition missing';
  END IF;

  IF has_function_privilege('anon', 'public.get_or_create_dm(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R02 self-test failed: anon can execute get_or_create_dm';
  END IF;
END $$;

COMMIT;
