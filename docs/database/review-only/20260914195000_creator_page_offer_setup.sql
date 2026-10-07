-- LOCAL / REVIEW ONLY. Recover existing offer/course and capacity contracts,
-- with private-course read protection and a checked owner offer write.
-- No page teammate ticket-setup decision, bank authority or refund grant here.
-- Inherited offer source SHA256: 779790b12e2ccb82087be6745087dd25ce6289c064c3a44a5bc86cb0bd863981
-- Inherited capacity source SHA256: 8612d0f739908160224cd2cec3908ca627b24b59231d3948fc017fa2ba55044b
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='explore_events' AND column_name='offer_type')
 OR to_regclass('public.event_offer_sessions') IS NOT NULL
 OR to_regprocedure('public.operator_set_event_ticket_capacity(uuid,integer)') IS NOT NULL THEN
  RAISE EXCEPTION 'Reconcile installed offer/capacity schema before recovery'; END IF;
END $$;


DO $$
BEGIN
  IF to_regclass('public.explore_events') IS NULL THEN
    RAISE EXCEPTION 'flexible offer types dependency missing: public.explore_events';
  END IF;
  -- is_admin()/has_role() are used below (matching the 20260817180000
  -- community_creator_invites precedent, which does not pre-check them
  -- either); not pre-checked here since their exact overload signature
  -- cannot be confirmed without a live DB, and CREATE FUNCTION itself will
  -- fail loudly at apply time if either is genuinely missing.
  IF to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'flexible offer types dependency missing: public.update_updated_at_column()';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. offer_type on explore_events
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_offer_type') THEN
    CREATE TYPE public.event_offer_type AS ENUM
      ('free_event', 'ticketed_event', 'course', 'drop_in', 'class_pack', 'subscription');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'explore_events' AND column_name = 'offer_type'
  ) THEN
    ALTER TABLE public.explore_events
      ADD COLUMN offer_type public.event_offer_type NOT NULL DEFAULT 'ticketed_event';
  END IF;
END $$;

COMMENT ON COLUMN public.explore_events.offer_type IS
  'The creator''s chosen promise type (CTO scope item 9 / C-18): free_event, ticketed_event, course, drop_in, class_pack, or subscription. Defaults to ticketed_event for every pre-existing row. Only course carries a real structural mechanic today (event_offer_sessions); class_pack and subscription are labels only until their own product mechanics are specified.';

-- ---------------------------------------------------------------------------
-- 2. event_offer_sessions -- the course's required series of dates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_offer_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.explore_events(id) ON DELETE CASCADE,
  session_start timestamptz NOT NULL,
  session_end   timestamptz,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (session_end IS NULL OR session_end > session_start)
);

-- one series entry per exact start time per event -- mirrors
-- validateCourseSessions()'s duplicate-start refusal
CREATE UNIQUE INDEX IF NOT EXISTS event_offer_sessions_event_start_idx
  ON public.event_offer_sessions (event_id, session_start);

CREATE INDEX IF NOT EXISTS event_offer_sessions_event_idx
  ON public.event_offer_sessions (event_id, sort_order);

CREATE TRIGGER update_event_offer_sessions_updated_at
  BEFORE UPDATE ON public.event_offer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- a session row only makes sense under a 'course' offer -- refuse rather
-- than let a drop-in/ticketed event silently accumulate orphaned dates
CREATE OR REPLACE FUNCTION public.event_offer_sessions_require_course()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_type public.event_offer_type;
BEGIN
  SELECT offer_type INTO v_type FROM public.explore_events WHERE id = new.event_id;
  IF v_type IS DISTINCT FROM 'course' THEN
    RAISE EXCEPTION 'event_offer_sessions requires offer_type = course (event % is %)', new.event_id, v_type;
  END IF;
  RETURN new;
END;
$$;

CREATE TRIGGER event_offer_sessions_require_course_guard
  BEFORE INSERT ON public.event_offer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.event_offer_sessions_require_course();

COMMENT ON TABLE public.event_offer_sessions IS
  'The required session series for a course offer (offer_type = course). "A multi-session course represents the required series of dates and enrollment as one offer" (CTO scope item 9). All mutation goes through set_event_offer_sessions(); there is no client-facing INSERT/UPDATE/DELETE policy.';

-- ---------------------------------------------------------------------------
-- 3. set_event_offer_sessions -- the creator's (or admin's) write path
-- ---------------------------------------------------------------------------

-- Full-set replace, one call, one transaction: mirrors
-- validateCourseSessions() in lib/offerTypes.ts exactly (min 2, max 52
-- sessions, real parseable timestamps, end after start, no duplicate
-- starts) -- keep the two in lockstep if either changes. p_sessions is a
-- jsonb array of {"start": iso8601, "end": iso8601 | null}.
CREATE OR REPLACE FUNCTION public.set_event_offer_sessions(
  p_event_id uuid,
  p_sessions jsonb
)
RETURNS SETOF public.event_offer_sessions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_event record;
  v_item  jsonb;
  v_start timestamptz;
  v_end   timestamptz;
  v_n     integer := 0;
  v_idx   integer := 0;
  v_seen  timestamptz[] := ARRAY[]::timestamptz[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id, host_user_id, offer_type INTO v_event
  FROM public.explore_events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'event not found' USING ERRCODE = '22023';
  END IF;
  IF v_event.host_user_id IS DISTINCT FROM v_uid
     AND NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'only this event''s creator can set its course dates' USING ERRCODE = '42501';
  END IF;
  IF v_event.offer_type IS DISTINCT FROM 'course' THEN
    RAISE EXCEPTION 'this event is not set up as a course (offer_type = %)', v_event.offer_type USING ERRCODE = '22023';
  END IF;

  IF p_sessions IS NULL OR jsonb_typeof(p_sessions) <> 'array' THEN
    RAISE EXCEPTION 'a course needs its list of dates' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_sessions);
  IF v_n < 2 THEN
    RAISE EXCEPTION 'a course needs at least 2 dates.' USING ERRCODE = '22023';
  END IF;
  IF v_n > 52 THEN
    RAISE EXCEPTION 'that is more dates than a single course can hold.' USING ERRCODE = '22023';
  END IF;

  -- validate every item BEFORE mutating anything
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_sessions) LOOP
    BEGIN
      v_start := (v_item->>'start')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'one of those dates did not read as a real date.' USING ERRCODE = '22023';
    END;
    IF v_start IS NULL THEN
      RAISE EXCEPTION 'one of those dates did not read as a real date.' USING ERRCODE = '22023';
    END IF;
    IF v_item ? 'end' AND (v_item->>'end') IS NOT NULL THEN
      BEGIN
        v_end := (v_item->>'end')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'one of those end times did not read as a real date.' USING ERRCODE = '22023';
      END;
      IF v_end <= v_start THEN
        RAISE EXCEPTION 'a session has to end after it starts.' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_start = ANY(v_seen) THEN
      RAISE EXCEPTION 'two sessions land on the exact same start time.' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_start);
  END LOOP;

  -- full-set replace, atomic with the reinsert
  DELETE FROM public.event_offer_sessions WHERE event_id = p_event_id;

  v_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_sessions) LOOP
    v_start := (v_item->>'start')::timestamptz;
    v_end := CASE WHEN v_item ? 'end' AND (v_item->>'end') IS NOT NULL THEN (v_item->>'end')::timestamptz ELSE NULL END;
    INSERT INTO public.event_offer_sessions (event_id, session_start, session_end, sort_order)
    VALUES (p_event_id, v_start, v_end, v_idx);
    v_idx := v_idx + 1;
  END LOOP;

  RETURN QUERY SELECT * FROM public.event_offer_sessions WHERE event_id = p_event_id ORDER BY sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.set_event_offer_sessions(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_offer_sessions(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_offer_sessions ENABLE ROW LEVEL SECURITY;

-- public: a course's dates are pre-purchase information, same trust level
-- as ticket_tiers pricing (already read through the anon-key client).
CREATE POLICY event_offer_sessions_select ON public.event_offer_sessions
  FOR SELECT USING (true);

-- No INSERT/UPDATE policy: all writes go through set_event_offer_sessions().
CREATE POLICY event_offer_sessions_delete ON public.event_offer_sessions
  FOR DELETE USING (
    is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 5. schema self-test
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_offer_sessions'::regclass) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: RLS not enabled on event_offer_sessions';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_offer_sessions') = 0 THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: no policies on event_offer_sessions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'event_offer_sessions' AND cmd IN ('INSERT', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a client-facing INSERT/UPDATE policy exists (mutation must stay RPC-only)';
  END IF;
  RAISE NOTICE 'event_offer_sessions schema self-test passed';
END $$;


-- Correct the inherited unrestricted private-draft date projection before any
-- activation commits. Public course dates follow existing event visibility.
DROP POLICY event_offer_sessions_select ON public.event_offer_sessions;
CREATE POLICY event_offer_sessions_select ON public.event_offer_sessions FOR SELECT
 USING(public.creator_event_is_visible(event_id) OR public.creator_event_can_manage(event_id)
  OR public.is_admin(auth.uid()) OR public.has_role(auth.uid(),'admin'::public.app_role));

CREATE FUNCTION public.operator_set_event_offer_type(p_event_id uuid,p_offer_type text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.explore_events; v_uid uuid:=auth.uid();
BEGIN
 SELECT * INTO e FROM public.explore_events WHERE id=p_event_id FOR UPDATE;
 IF v_uid IS NULL OR e.id IS NULL OR NOT coalesce((
  ((e.host_user_id=v_uid OR (e.community_id IS NOT NULL AND public.is_community_leader(e.community_id,v_uid)))
   AND public.creator_event_owner_is_eligible(e.id))
  OR public.is_admin(v_uid) OR public.has_role(v_uid,'admin'::public.app_role)),false) THEN
  RAISE EXCEPTION 'Event unavailable' USING ERRCODE='42501'; END IF;
 -- Match the four currently supported choices; stored enum labels for future
 -- mechanics are retained from the inherited source, not activated here.
 IF p_offer_type IS NULL OR p_offer_type NOT IN('free_event','ticketed_event','course','drop_in') THEN
  RAISE EXCEPTION 'Choose a supported event offer' USING ERRCODE='22023'; END IF;
 UPDATE public.explore_events SET offer_type=p_offer_type::public.event_offer_type,updated_at=now() WHERE id=e.id;
 RETURN jsonb_build_object('event_id',e.id,'offer_type',p_offer_type);
END;
$$;
REVOKE ALL ON FUNCTION public.operator_set_event_offer_type(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_set_event_offer_type(uuid,text) TO authenticated;
create or replace function public.operator_set_event_ticket_capacity(
  p_event_id uuid,
  p_ticket_capacity integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select id, host_user_id, community_id into v_row
  from explore_events where id = p_event_id;
  if v_row.id is null then
    raise exception 'Event not found';
  end if;
  if not coalesce((v_row.host_user_id = v_uid
          or (v_row.community_id is not null and is_community_leader(v_row.community_id, v_uid))),false) then
    raise exception 'Not authorized';
  end if;
  if p_ticket_capacity is not null and p_ticket_capacity <= 0 then
    raise exception 'Capacity has to be at least 1, or left blank for unlimited.';
  end if;

  update explore_events set
    ticket_capacity = p_ticket_capacity,
    updated_at = now()
  where id = p_event_id;
end;
$function$;

-- privileges (the write-RPC pattern: never anon, never public)
revoke all on function public.operator_set_event_ticket_capacity(uuid, integer) from public;
revoke all on function public.operator_set_event_ticket_capacity(uuid, integer) from anon;
grant execute on function public.operator_set_event_ticket_capacity(uuid, integer) to authenticated;


COMMIT;
