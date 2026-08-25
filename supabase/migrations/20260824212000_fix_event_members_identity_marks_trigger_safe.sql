-- Safe forward replacement for the archived 20260824190000 draft.
-- Defines the trigger dependency from source control, preserves the direct
-- caller identity check, and verifies only catalog state. Behavioral proof is
-- isolated in supabase/tests/contracts and never selects or writes real users.

BEGIN;

CREATE INDEX IF NOT EXISTS event_members_user_joined_event_idx
  ON public.event_members (user_id, event_id)
  WHERE status = 'joined';

CREATE OR REPLACE FUNCTION public._member_identity_marks_apply(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_mark_id uuid;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.event_members em
  JOIN public.events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id AND em.status = 'joined'
    AND extract(hour FROM e.start_time AT TIME ZONE 'America/Los_Angeles') >= 20;
  IF v_count >= 3 THEN
    SELECT id INTO v_mark_id FROM public.marks WHERE slug = 'night-owl';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO public.user_marks(user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.event_members em
  JOIN public.events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id AND em.status = 'joined'
    AND extract(hour FROM e.start_time AT TIME ZONE 'America/Los_Angeles') < 12;
  IF v_count >= 3 THEN
    SELECT id INTO v_mark_id FROM public.marks WHERE slug = 'early-bird';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO public.user_marks(user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.event_members em
  JOIN public.events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id AND em.status = 'joined' AND e.primary_vibe = 'outdoors';
  IF v_count >= 3 THEN
    SELECT id INTO v_mark_id FROM public.marks WHERE slug = 'trailblazer';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO public.user_marks(user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.event_members em
  JOIN public.events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id AND em.status = 'joined'
    AND e.primary_vibe IN ('art', 'film', 'music', 'comedy');
  IF v_count >= 3 THEN
    SELECT id INTO v_mark_id FROM public.marks WHERE slug = 'culture-club';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO public.user_marks(user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT other.user_id
    FROM public.event_members me
    JOIN public.event_members other
      ON other.event_id = me.event_id
     AND other.user_id <> me.user_id
     AND other.status = 'joined'
    WHERE me.user_id = p_user_id AND me.status = 'joined'
    GROUP BY other.user_id
    HAVING count(DISTINCT me.event_id) >= 3
  ) pairs;
  IF v_count >= 1 THEN
    SELECT id INTO v_mark_id FROM public.marks WHERE slug = 'the-regular';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO public.user_marks(user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;

  SELECT count(DISTINCT e.primary_vibe) INTO v_count
  FROM public.event_members em
  JOIN public.events e ON e.id = em.event_id
  WHERE em.user_id = p_user_id AND em.status = 'joined' AND e.primary_vibe IS NOT NULL;
  IF v_count >= 3 THEN
    SELECT id INTO v_mark_id FROM public.marks WHERE slug = 'explorer';
    IF v_mark_id IS NOT NULL THEN
      INSERT INTO public.user_marks(user_id, mark_id) VALUES (p_user_id, v_mark_id)
      ON CONFLICT (user_id, mark_id) DO NOTHING;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._member_identity_marks_apply(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_member_identity_marks(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public._member_identity_marks_apply(p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.check_member_identity_marks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_member_identity_marks(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_event_members_insert_check_marks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'joined' THEN
    PERFORM public._member_identity_marks_apply(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_event_members_insert_check_marks() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_event_members_after_insert_marks ON public.event_members;
CREATE TRIGGER trg_event_members_after_insert_marks
AFTER INSERT ON public.event_members
FOR EACH ROW EXECUTE FUNCTION public.trg_event_members_insert_check_marks();

DO $$
DECLARE
  v_trigger_function oid;
BEGIN
  IF has_function_privilege('anon', 'public._member_identity_marks_apply(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._member_identity_marks_apply(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal member-marks helper is client-callable';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.check_member_identity_marks(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.check_member_identity_marks(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public member-marks grants are incorrect';
  END IF;
  SELECT t.tgfoid INTO v_trigger_function
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.event_members'::regclass
    AND t.tgname = 'trg_event_members_after_insert_marks'
    AND NOT t.tgisinternal;
  IF v_trigger_function IS DISTINCT FROM 'public.trg_event_members_insert_check_marks()'::regprocedure::oid THEN
    RAISE EXCEPTION 'event_members identity-marks trigger is missing or miswired';
  END IF;
  IF position('auth.uid() <> p_user_id' IN pg_get_functiondef('public.check_member_identity_marks(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'direct member-marks identity guard is missing';
  END IF;
END $$;

COMMIT;
