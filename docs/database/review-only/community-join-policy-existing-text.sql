-- REVIEW ONLY. NON-EXECUTABLE PROPOSAL. DO NOT APPLY.
--
-- Narrow replacement for 20260819050000_community_join_policy.sql against the
-- database shape actually observed on 2026-08-24: communities.join_policy is
-- already text NOT NULL DEFAULT 'open', and the five existing communities are
-- open. This file does not recreate or recast the column, change its default,
-- update an existing row, or replace request_to_join_community(). Treatment of
-- those five rows is blocked on Liz. Josh must separately approve any
-- production database change.
--
-- The current live request_to_join_community body is newer than the old draft
-- and already reads text join_policy. It is intentionally left byte-for-byte
-- alone. This proposal only adds the allowed-value boundary and guarded
-- role-gated RPC required by the clients. Owner, Admin, and Member care access
-- follows Liz's S-03 door/roster permission model. It deliberately leaves the live
-- default in place for compatibility. A later client/RPC phase must require an
-- explicit choice before that default can be removed safely.

BEGIN;

DO $$
DECLARE
  v_type text;
  v_nullable text;
  v_default text;
BEGIN
  SELECT data_type, is_nullable, column_default
  INTO v_type, v_nullable, v_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'communities'
    AND column_name = 'join_policy';

  IF v_type IS DISTINCT FROM 'text'
     OR v_nullable IS DISTINCT FROM 'NO'
     OR v_default IS DISTINCT FROM '''open''::text' THEN
    RAISE EXCEPTION
      'community join policy live shape changed (type %, nullable %, default %); refusing to apply',
      v_type, v_nullable, v_default;
  END IF;
END $$;

-- Add only a validation boundary. There is deliberately no data UPDATE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.communities'::regclass
      AND conname = 'communities_join_policy_allowed_check'
  ) THEN
    ALTER TABLE public.communities
      ADD CONSTRAINT communities_join_policy_allowed_check
      CHECK (join_policy IN ('open', 'approval_required')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.communities
  VALIDATE CONSTRAINT communities_join_policy_allowed_check;

COMMENT ON COLUMN public.communities.join_policy IS
  'Creator-selected join behavior. Existing-row treatment and any default change require Liz approval.';

CREATE OR REPLACE FUNCTION public.set_community_join_policy(
  p_community_id uuid,
  p_join_policy text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_found uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_join_policy IS NULL OR p_join_policy NOT IN ('open', 'approval_required') THEN
    RAISE EXCEPTION 'Unsupported join policy' USING ERRCODE = '22023';
  END IF;
  UPDATE public.communities
  SET join_policy = p_join_policy
  WHERE id = p_community_id
    AND (
      created_by = v_uid
      OR EXISTS (
        SELECT 1
        FROM public.community_members cm
        WHERE cm.community_id = p_community_id
          AND cm.user_id = v_uid
          AND cm.status = 'active'
          AND cm.role IN ('admin', 'member_care')
      )
    )
  RETURNING id INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'Member-care access required' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Unlike the superseded draft, the guard does not use a caller-settable
-- custom GUC. A direct authenticated UPDATE runs as authenticated and fails.
-- The SECURITY DEFINER setter runs as its owner. Other same-owner privileged
-- routines remain technically capable, so this is the guarded client door,
-- not proof of provenance for every database-owner write.
CREATE OR REPLACE FUNCTION public.communities_guard_join_policy_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_setter_owner name;
BEGIN
  IF NEW.join_policy IS NOT DISTINCT FROM OLD.join_policy THEN
    RETURN NEW;
  END IF;

  SELECT role.rolname
  INTO v_setter_owner
  FROM pg_proc fn
  JOIN pg_roles role ON role.oid = fn.proowner
  WHERE fn.oid = 'public.set_community_join_policy(uuid,text)'::regprocedure;

  IF current_user IS DISTINCT FROM v_setter_owner THEN
    RAISE EXCEPTION 'join_policy can only be changed through set_community_join_policy()'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS communities_guard_join_policy_write ON public.communities;
CREATE TRIGGER communities_guard_join_policy_write
  BEFORE UPDATE OF join_policy ON public.communities
  FOR EACH ROW
  EXECUTE FUNCTION public.communities_guard_join_policy_write();

REVOKE ALL ON FUNCTION public.set_community_join_policy(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_community_join_policy(uuid, text) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.communities'::regclass
      AND conname = 'communities_join_policy_allowed_check'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'community join policy constraint missing or unvalidated';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc
          WHERE oid = 'public.set_community_join_policy(uuid,text)'::regprocedure) THEN
    RAISE EXCEPTION 'set_community_join_policy is missing SECURITY DEFINER';
  END IF;
END $$;

COMMIT;
