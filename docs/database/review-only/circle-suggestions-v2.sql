-- REVIEW ONLY. NON-EXECUTABLE PROPOSAL. DO NOT APPLY.
--
-- Production preparation for Liz's 3-or-more people across 3-or-more Plans
-- threshold. This adopts the older 20260605 engineering draft's conservative
-- exact-roster v1, rather than inventing fuzzy overlapping-set clustering.
-- This file does not schedule or enable the job.
-- Applying it remains blocked on Liz's decision about where the suggestion is
-- surfaced, plus Josh's separate approval for a production database change.
--
-- Compared with the 20260605 draft, this version also:
--   * suppresses a suggestion when the exact people already share a Circle;
--   * enforces one pending/converted suggestion per user and canonical people set;
--   * keeps detection service-only and status changes owner-only;
--   * honors the canonical two-way block helper during detection and reads;
--   * refreshes pending evidence without creating duplicate active suggestions.
--
-- UNRESOLVED PRODUCT CHOICE: this preserves the original draft's behavior in
-- which a dismissed suggestion may resurface on a later detection run. Do not
-- change that persistence rule or apply this file until Liz confirms it.
-- PERFORMANCE GATE: detection groups the full joined-membership history. Before
-- any scheduling decision, capture EXPLAIN ANALYZE against a production-shaped
-- clone and define a bounded lookback or incremental cursor if the scan is not
-- comfortably below the cron budget. No new live index is proposed blindly.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.circle_suggestions') IS NULL
     OR to_regclass('public.event_members') IS NULL
     OR to_regclass('public.circle_members') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('public.yours_is_blocked_between(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'circle suggestions v2 dependency missing; refusing to apply';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.circle_canonical_uuid_array(p_values uuid[])
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(array_agg(item ORDER BY item), ARRAY[]::uuid[])
  FROM (SELECT DISTINCT unnest(p_values) AS item) canonical
$$;

REVOKE ALL ON FUNCTION public.circle_canonical_uuid_array(uuid[]) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.circle_suggestions'::regclass
      AND conname = 'circle_suggestions_canonical_people_check'
  ) THEN
    ALTER TABLE public.circle_suggestions
      ADD CONSTRAINT circle_suggestions_canonical_people_check
      CHECK (
        suggested_user_ids = public.circle_canonical_uuid_array(suggested_user_ids)
        AND array_position(suggested_user_ids, NULL) IS NULL
        AND NOT (user_id = ANY(suggested_user_ids))
      ) NOT VALID;
  END IF;
END $$;

-- Existing noncanonical rows are not silently rewritten. Validation fails and
-- forces a separately reviewed data reconciliation instead.
ALTER TABLE public.circle_suggestions
  VALIDATE CONSTRAINT circle_suggestions_canonical_people_check;

-- A dismissed suggestion is allowed to resurface, matching the original
-- status contract pending Liz's decision. Pending and converted rows are
-- durable deduplication keys.
-- This intentionally fails instead of deleting or merging unexpected live
-- duplicates. Any cleanup needs its own reviewed data migration.
CREATE UNIQUE INDEX circle_suggestions_one_active_exact_set_v2_idx
  ON public.circle_suggestions (user_id, suggested_user_ids)
  WHERE status IN ('pending', 'converted');

CREATE OR REPLACE FUNCTION public.get_circle_suggestions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT
      s.id,
      s.suggested_user_ids,
      s.shared_event_ids,
      COALESCE(array_length(s.shared_event_ids, 1), 0) AS shared_count,
      s.created_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', p.id,
          'first_name_display', p.first_name_display,
          'handle', p.handle,
          'profile_photo_url', p.profile_photo_url
        ) ORDER BY p.first_name_display, p.id)
        FROM public.profiles p
        WHERE p.id = ANY(s.suggested_user_ids)
      ), '[]'::jsonb) AS people
    FROM public.circle_suggestions s
    WHERE s.user_id = v_uid
      AND s.status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(s.suggested_user_ids || ARRAY[v_uid]) AS left_person(user_id)
        CROSS JOIN unnest(s.suggested_user_ids || ARRAY[v_uid]) AS right_person(user_id)
        WHERE left_person.user_id < right_person.user_id
          AND public.yours_is_blocked_between(left_person.user_id, right_person.user_id)
      )
      -- A pending row is historical evidence, but it must still have at least
      -- three qualifying exact-roster Plans when read. If membership truth is
      -- corrected later, stale identity data is hidden without deleting history.
      AND 3 <= (
        SELECT count(*)
        FROM unnest(s.shared_event_ids) AS shared(event_id)
        WHERE (
          SELECT array_agg(DISTINCT em.user_id ORDER BY em.user_id)
          FROM public.event_members em
          WHERE em.event_id = shared.event_id
            AND em.status = 'joined'
        ) = public.circle_canonical_uuid_array(s.suggested_user_ids || ARRAY[s.user_id])
      )
      -- Hide a stale pending nudge if these exact people have since formed a
      -- Circle through any other path. No row is deleted or rewritten here.
      AND NOT EXISTS (
        SELECT 1
        FROM public.circle_members self_member
        WHERE self_member.user_id = s.user_id
          AND self_member.status = 'joined'
          AND (
            SELECT array_agg(cm.user_id ORDER BY cm.user_id)
            FROM public.circle_members cm
            WHERE cm.circle_id = self_member.circle_id
              AND cm.status = 'joined'
          ) = ARRAY(
            SELECT person_id
            FROM unnest(s.suggested_user_ids || ARRAY[s.user_id]) AS person(person_id)
            ORDER BY person_id
          )
      )
  ) d;

  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_circle_suggestion_status(
  p_id uuid,
  p_status text
)
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
  IF p_status IS NULL OR p_status NOT IN ('dismissed', 'converted') THEN
    RAISE EXCEPTION 'invalid status %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.circle_suggestions
  SET status = p_status
  WHERE id = p_id
    AND user_id = v_uid
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  RETURN p_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_circle_suggestions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH event_sets AS (
    SELECT
      em.event_id,
      array_agg(DISTINCT em.user_id ORDER BY em.user_id) AS member_set
    FROM public.event_members em
    WHERE em.status = 'joined'
    GROUP BY em.event_id
    HAVING count(DISTINCT em.user_id) >= 3
  ),
  recurring AS (
    SELECT
      member_set,
      array_agg(event_id ORDER BY event_id) AS event_ids,
      count(*) AS plan_count
    FROM event_sets
    GROUP BY member_set
    HAVING count(*) >= 3
  ),
  per_user AS (
    SELECT
      member.uid AS user_id,
      ARRAY(
        SELECT person_id
        FROM unnest(r.member_set) AS person(person_id)
        WHERE person_id <> member.uid
        ORDER BY person_id
      ) AS suggested_user_ids,
      r.event_ids,
      r.plan_count,
      r.member_set
    FROM recurring r
    CROSS JOIN LATERAL unnest(r.member_set) AS member(uid)
  ),
  eligible AS (
    SELECT pu.*
    FROM per_user pu
    WHERE array_length(pu.suggested_user_ids, 1) >= 2
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(pu.member_set) AS left_person(user_id)
        CROSS JOIN unnest(pu.member_set) AS right_person(user_id)
        WHERE left_person.user_id < right_person.user_id
          AND public.yours_is_blocked_between(left_person.user_id, right_person.user_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.circle_members self_member
        WHERE self_member.user_id = pu.user_id
          AND self_member.status = 'joined'
          AND (
            SELECT array_agg(cm.user_id ORDER BY cm.user_id)
            FROM public.circle_members cm
            WHERE cm.circle_id = self_member.circle_id
              AND cm.status = 'joined'
          ) = pu.member_set
      )
  ),
  inserted AS (
    INSERT INTO public.circle_suggestions
      (user_id, suggested_user_ids, shared_event_ids, basis, score, status)
    SELECT
      user_id,
      suggested_user_ids,
      event_ids,
      'co_attendance',
      plan_count,
      'pending'
    FROM eligible
    ON CONFLICT (user_id, suggested_user_ids)
      WHERE status IN ('pending', 'converted')
      DO UPDATE
      SET shared_event_ids = EXCLUDED.shared_event_ids,
          score = EXCLUDED.score
      WHERE circle_suggestions.status = 'pending'
        AND (
          circle_suggestions.shared_event_ids IS DISTINCT FROM EXCLUDED.shared_event_ids
          OR circle_suggestions.score IS DISTINCT FROM EXCLUDED.score
        )
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM inserted;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_circle_suggestions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_circle_suggestion_status(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detect_circle_suggestions() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_circle_suggestions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_circle_suggestion_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_circle_suggestions() TO service_role;

DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_circle_suggestions()',
    'public.set_circle_suggestion_status(uuid,text)',
    'public.detect_circle_suggestions()'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL OR NOT (
      SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_signature)
    ) THEN
      RAISE EXCEPTION 'circle suggestions RPC % missing or not SECURITY DEFINER', v_signature;
    END IF;
  END LOOP;
END $$;

COMMIT;
