-- Remote flags: server-driven feature control so enabling / gradual ramp /
-- kill / holdout is a single row edit, NOT an app build. EXPO_PUBLIC_* stays
-- only as an OFFLINE fallback for `enabled` if this read fails.
--
-- One row per feature: { enabled, rollout_pct, holdout_pct }. The client reads
-- it once per session at the trigger and buckets the user by a stable hash of
-- their id: in-rollout if hash%100 < rollout_pct; within that, held (control)
-- if a second hash%100 < holdout_pct.
--
-- First consumer: the post-join re-enable-notifications soft-prompt.
--
-- NOT YET APPLIED TO PROD; ships with the feature PR, apply at rollout. Ships
-- OFF (enabled=false, 0% rollout), so applying it early is inert.
--
-- Self-test at the bottom asserts the table, RLS policy, and seed row, and
-- rolls the whole migration back on any failed assertion.

CREATE TABLE IF NOT EXISTS public.remote_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  rollout_pct int NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  holdout_pct int NOT NULL DEFAULT 0 CHECK (holdout_pct BETWEEN 0 AND 100),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Read-only to signed-in clients. Writes are dashboard / service-role only
-- (no client INSERT/UPDATE/DELETE policy exists, so RLS denies them).
ALTER TABLE public.remote_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS remote_flags_read ON public.remote_flags;
CREATE POLICY remote_flags_read ON public.remote_flags
  FOR SELECT TO authenticated USING (true);

-- Seed the first flag OFF (0% rollout, 0% holdout) so the feature is inert
-- until Liz edits the row.
INSERT INTO public.remote_flags (key, enabled, rollout_pct, holdout_pct)
VALUES ('notif_reenable_prompt', false, 0, 0)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  v_tbl int;
  v_pol int;
  v_row int;
BEGIN
  SELECT count(*) INTO v_tbl
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'remote_flags';
  IF v_tbl <> 1 THEN
    RAISE EXCEPTION 'ASSERT: remote_flags table missing';
  END IF;

  SELECT count(*) INTO v_pol
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'remote_flags' AND policyname = 'remote_flags_read';
  IF v_pol <> 1 THEN
    RAISE EXCEPTION 'ASSERT: remote_flags_read policy missing';
  END IF;

  SELECT count(*) INTO v_row
  FROM public.remote_flags
  WHERE key = 'notif_reenable_prompt' AND enabled = false;
  IF v_row <> 1 THEN
    RAISE EXCEPTION 'ASSERT: notif_reenable_prompt seed row missing or not OFF';
  END IF;

  RAISE NOTICE 'remote_flags self-test passed';
END $$;
