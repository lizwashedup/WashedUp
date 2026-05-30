-- Circles (people + circles). 2/4: co-attendance suggestions + The Room prep.
--
-- REVIEW ONLY. Not applied by the agent. See 1/4 header for prod-reconcile
-- notes. Verified 2026-05-30 against project upstjumasqblszevlgik.
--
-- These tables are created EMPTY with NO logic, NO triggers, and NO cron this
-- session. The Room (brief generation, listener, planner) is built later. The
-- only purpose here is to lock the table shapes so later work is additive.
--
-- RLS posture: circle_suggestions is readable by the user it targets. The
-- three Room-internal tables (circle_briefs, circle_listener_state,
-- planner_queue) have RLS enabled with NO policies, so they are reachable only
-- by service_role / SECURITY DEFINER code, never directly by the client.
--
-- Idempotent. Wrapped BEGIN/COMMIT with a final self-test DO block.

BEGIN;

-- ---------------------------------------------------------------------------
-- circle_suggestions: "people you keep showing up with could be a circle".
-- Populated later by a co-attendance detection job. Empty for now.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.circle_suggestions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  suggested_user_ids   uuid[] NOT NULL DEFAULT '{}',
  shared_event_ids     uuid[] NOT NULL DEFAULT '{}',
  basis                text NOT NULL DEFAULT 'co_attendance',
  score                numeric,
  status               text NOT NULL DEFAULT 'pending',
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT circle_suggestions_status_check
    CHECK (status IN ('pending', 'dismissed', 'converted'))
);

CREATE INDEX IF NOT EXISTS idx_circle_suggestions_user
  ON public.circle_suggestions (user_id, status);

-- ---------------------------------------------------------------------------
-- circle_briefs: generated noticeboard / Room brief text per circle. Empty.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.circle_briefs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id   uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  content     text,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT circle_briefs_status_check
    CHECK (status IN ('pending', 'ready', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_circle_briefs_circle
  ON public.circle_briefs (circle_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- circle_listener_state: per-circle cursor for the Room listener. Empty.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.circle_listener_state (
  circle_id                 uuid PRIMARY KEY REFERENCES public.circles(id) ON DELETE CASCADE,
  last_processed_message_id uuid,
  last_run_at               timestamptz,
  state                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- planner_queue: queued Room planner jobs. Empty. No worker this session.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  job_type      text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued',
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  CONSTRAINT planner_queue_status_check
    CHECK (status IN ('queued', 'processing', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_planner_queue_pending
  ON public.planner_queue (circle_id, created_at)
  WHERE status = 'queued';

-- ---------------------------------------------------------------------------
-- RLS. Suggestions: readable by the target user. Room-internal tables: RLS on,
-- no policies (service_role / SECURITY DEFINER only).
-- ---------------------------------------------------------------------------
ALTER TABLE public.circle_suggestions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_briefs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_listener_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_queue         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS circle_suggestions_select_own ON public.circle_suggestions;
CREATE POLICY circle_suggestions_select_own ON public.circle_suggestions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'public.circle_suggestions',
    'public.circle_briefs',
    'public.circle_listener_state',
    'public.planner_queue'
  ]
  LOOP
    IF to_regclass(v_tbl) IS NULL THEN
      RAISE EXCEPTION 'Room-prep table % missing', v_tbl;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid = v_tbl::regclass AND relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS not enabled on %', v_tbl;
    END IF;
  END LOOP;
END $$;

COMMIT;
