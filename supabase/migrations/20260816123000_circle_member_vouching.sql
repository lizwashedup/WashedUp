-- REVIEW ONLY. Forward migration. Do not apply without explicit approval.
--
-- R04: Circle membership must have an explicit trust edge.
--   * A new Circle can seed only the creator's accepted, unblocked Your People.
--   * Any current Circle member may vouch for their own accepted, unblocked
--     Your People through the existing invite_to_circle RPC.
--   * A caller cannot self-join a Circle by UUID through join_circle_atomic.
--   * Co-attendance suggestions are deliberately untouched.
--
-- Existing function names, arguments, return types, and existing columns are
-- preserved. invited_by_user_id is additive attribution for the member who
-- supplied the trust edge.
--
-- Explicit assumption requiring review:
--   `removed` is a moderation state. The existing behavior that lets an admin
--   restore it is retained, but a plain member cannot restore it. A plain-member
--   vouch that restores a voluntarily `left` row restores it as role `member`,
--   so vouching cannot silently grant admin rights.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.yours_is_connected(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'R04 dependency missing: public.yours_is_connected(uuid,uuid)';
  END IF;
  IF to_regprocedure('public.yours_is_blocked_between(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'R04 dependency missing: public.yours_is_blocked_between(uuid,uuid)';
  END IF;
  IF to_regprocedure('public.is_circle_member(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_circle_admin(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'R04 dependency missing: Circle membership helpers';
  END IF;
END $$;

ALTER TABLE public.circle_members
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.circle_members'::regclass
      AND conname = 'circle_members_invited_by_user_id_fkey'
  ) THEN
    ALTER TABLE public.circle_members
      ADD CONSTRAINT circle_members_invited_by_user_id_fkey
      FOREIGN KEY (invited_by_user_id)
      REFERENCES public.profiles(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.circle_members
  VALIDATE CONSTRAINT circle_members_invited_by_user_id_fkey;

CREATE INDEX IF NOT EXISTS idx_circle_members_invited_by
  ON public.circle_members (invited_by_user_id)
  WHERE invited_by_user_id IS NOT NULL;

COMMENT ON COLUMN public.circle_members.invited_by_user_id IS
  'The current Circle member whose accepted Your People relationship supplied this membership trust edge. Null for the creator and pre-migration rows.';

-- Preserve the create_circle signature. Initial people must each be an
-- accepted, unblocked relationship of the creator. The creator row lands first,
-- then supplies attribution for the initial members in the same transaction.
CREATE OR REPLACE FUNCTION public.create_circle(
  p_name text,
  p_description text DEFAULT NULL,
  p_member_user_ids uuid[] DEFAULT '{}'
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_circle_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'circle name required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT unnest(COALESCE(p_member_user_ids, '{}'::uuid[])) AS uid
    ) candidate
    WHERE candidate.uid IS NOT NULL
      AND candidate.uid <> v_uid
      AND (
        NOT public.yours_is_connected(v_uid, candidate.uid)
        OR public.yours_is_blocked_between(v_uid, candidate.uid)
      )
  ) THEN
    RAISE EXCEPTION 'circle trust check failed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.circles (name, description, creator_user_id)
  VALUES (btrim(p_name), p_description, v_uid)
  RETURNING id INTO v_circle_id;

  INSERT INTO public.circle_members
    (circle_id, user_id, role, status, invited_by_user_id)
  VALUES
    (v_circle_id, v_uid, 'admin', 'joined', NULL);

  INSERT INTO public.circle_members
    (circle_id, user_id, role, status, invited_by_user_id)
  SELECT v_circle_id, candidate.uid, 'member', 'joined', v_uid
  FROM (
    SELECT DISTINCT unnest(COALESCE(p_member_user_ids, '{}'::uuid[])) AS uid
  ) candidate
  WHERE candidate.uid IS NOT NULL
    AND candidate.uid <> v_uid
  ON CONFLICT (circle_id, user_id) DO NOTHING;

  RETURN v_circle_id;
END;
$$;

-- Preserve the join_circle_atomic signature, but remove unauthenticated trust
-- creation. A current member receives the old idempotent success result. Every
-- other existing or new caller must be added by a current member instead.
CREATE OR REPLACE FUNCTION public.join_circle_atomic(p_circle_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.circles WHERE id = p_circle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF public.is_circle_member(p_circle_id, v_uid) THEN
    RETURN 'joined';
  END IF;

  RAISE EXCEPTION 'current-member vouch required' USING ERRCODE = '42501';
END;
$$;

-- Preserve the invite_to_circle signature and direct-add behavior. The caller
-- may be any current member, but every person who would enter or re-enter must
-- be that caller's accepted, unblocked Your People relationship.
CREATE OR REPLACE FUNCTION public.invite_to_circle(
  p_circle_id uuid,
  p_user_ids uuid[]
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_is_admin     boolean;
  v_targets      uuid[];
  v_added        uuid[];
  v_subject      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_circle_member(p_circle_id, v_uid) THEN
    RAISE EXCEPTION 'current Circle member required' USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_circle_admin(p_circle_id, v_uid);

  SELECT COALESCE(array_agg(candidate.uid ORDER BY candidate.uid), '{}'::uuid[])
  INTO v_targets
  FROM (
    SELECT DISTINCT unnest(COALESCE(p_user_ids, '{}'::uuid[])) AS uid
  ) candidate
  WHERE candidate.uid IS NOT NULL
    AND candidate.uid <> v_uid;

  -- Already-joined targets are no-ops. Every target that would transition must
  -- carry a current accepted and unblocked relationship to the caller.
  IF EXISTS (
    SELECT 1
    FROM unnest(v_targets) target(uid)
    LEFT JOIN public.circle_members existing
      ON existing.circle_id = p_circle_id
     AND existing.user_id = target.uid
    WHERE existing.status IS DISTINCT FROM 'joined'::public.member_status
      AND (
        NOT public.yours_is_connected(v_uid, target.uid)
        OR public.yours_is_blocked_between(v_uid, target.uid)
      )
  ) THEN
    RAISE EXCEPTION 'circle trust check failed' USING ERRCODE = '42501';
  END IF;

  -- Preserve the existing admin-only ability to restore a moderated row. Do
  -- not let the newly expanded plain-member path bypass a removal.
  IF NOT v_is_admin AND EXISTS (
    SELECT 1
    FROM public.circle_members existing
    WHERE existing.circle_id = p_circle_id
      AND existing.user_id = ANY(v_targets)
      AND existing.status = 'removed'
  ) THEN
    RAISE EXCEPTION 'admin required to restore a removed member' USING ERRCODE = '42501';
  END IF;

  WITH changed AS (
    INSERT INTO public.circle_members
      (circle_id, user_id, role, status, invited_by_user_id)
    SELECT p_circle_id, target.uid, 'member', 'joined', v_uid
    FROM unnest(v_targets) target(uid)
    ON CONFLICT (circle_id, user_id)
      DO UPDATE SET
        status = 'joined',
        invited_by_user_id = EXCLUDED.invited_by_user_id,
        role = CASE
          WHEN v_is_admin THEN public.circle_members.role
          ELSE 'member'::public.circle_role
        END,
        joined_at = now()
      WHERE public.circle_members.status <> 'joined'
    RETURNING user_id
  )
  SELECT array_agg(user_id ORDER BY user_id) INTO v_added FROM changed;

  FOREACH v_subject IN ARRAY COALESCE(v_added, '{}'::uuid[]) LOOP
    PERFORM public.post_circle_system_message(
      p_circle_id,
      v_subject,
      public.circle_display_name(v_subject) || ' joined'
    );
  END LOOP;

  RETURN COALESCE(array_length(v_added, 1), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.create_circle(text, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_circle_atomic(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_to_circle(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_circle(text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_circle_atomic(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_to_circle(uuid, uuid[]) TO authenticated;

DO $$
DECLARE
  v_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'circle_members'
      AND column_name = 'invited_by_user_id'
  ) THEN
    RAISE EXCEPTION 'R04 self-test failed: invited_by_user_id missing';
  END IF;

  SELECT pg_get_functiondef('public.invite_to_circle(uuid,uuid[])'::regprocedure)
  INTO v_definition;
  IF position('yours_is_connected' IN v_definition) = 0
     OR position('is_circle_member' IN v_definition) = 0
     OR position('post_circle_system_message' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'R04 self-test failed: trusted member-vouch function missing';
  END IF;

  SELECT pg_get_functiondef('public.join_circle_atomic(uuid)'::regprocedure)
  INTO v_definition;
  IF position('current-member vouch required' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'R04 self-test failed: outsider self-join guard missing';
  END IF;
END $$;

COMMIT;
