-- Push subscription-state sync: storage + reporting + schedule.
--
-- Gives device_tokens a truthful "is this device reachable" field, populated by
-- the sync-push-subscription-state edge function (reads OneSignal, writes here).
-- Motivation: a 2026-07 winback to ~175 opted-in June users delivered to only
-- 58 — the rest had notifications disabled at the OS level. Our DB could not see
-- that (profiles.push_* are default-true; only OneSignal knows). This makes real
-- reach queryable.
--
-- ADDITIVE ONLY. New columns + a new index + a new reporting RPC + a new cron
-- job. No existing column, function, or datum is modified. Fully reversible.
--
-- apply_migration runs in one transaction; the self-test at the bottom asserts
-- every object exists with the right shape and runs the reporting RPC once as a
-- live smoke test. Any failed assertion RAISEs and rolls back the whole thing.
-- (Supabase-branch migrations run standalone, so the guard is embedded here, not
-- in a separate harness.)

-- ── 1. Storage columns on device_tokens ─────────────────────────────────────
-- push_enabled: null = never synced yet; true/false = last known OneSignal
--   subscription enabled-state (OS-level permission on/off).
-- notification_types: raw OneSignal value kept for debugging (31/1 = on;
--   0/-18 = off), null when OneSignal knows no such subscription.
-- enabled_synced_at: when we last got an authoritative answer (drives the
--   stale-first refresh order in the edge function; NULLS FIRST index below).
ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS push_enabled       boolean,
  ADD COLUMN IF NOT EXISTS notification_types integer,
  ADD COLUMN IF NOT EXISTS enabled_synced_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_device_tokens_enabled_sync
  ON public.device_tokens (enabled_synced_at NULLS FIRST);

-- ── 2. Reporting RPC: true reach by signup cohort ───────────────────────────
-- The immediate payoff — reach comes straight from SQL instead of sampling
-- OneSignal by hand. Reporting/maintenance only, never a client RPC.
-- SECURITY DEFINER + fixed search_path + REVOKE ALL FROM PUBLIC (same posture
-- as the other cron/reporting functions in this project).
CREATE OR REPLACE FUNCTION public.get_push_reach()
RETURNS TABLE (
  cohort           text,
  users            bigint,
  with_token       bigint,
  synced_tokens    bigint,
  enabled_tokens   bigint,
  disabled_tokens  bigint,
  unsynced_tokens  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cohorts AS (
    SELECT
      p.id AS user_id,
      CASE
        WHEN p.created_at >= '2026-07-01' THEN 'july_plus'
        WHEN p.created_at >= '2026-06-01' THEN 'june'
        ELSE 'pre_june'
      END AS cohort
    FROM public.profiles p
  )
  SELECT
    c.cohort,
    count(DISTINCT c.user_id)                                             AS users,
    count(DISTINCT d.user_id)                                             AS with_token,
    count(d.onesignal_player_id) FILTER (WHERE d.enabled_synced_at IS NOT NULL) AS synced_tokens,
    count(d.onesignal_player_id) FILTER (WHERE d.push_enabled IS TRUE)          AS enabled_tokens,
    count(d.onesignal_player_id) FILTER (WHERE d.push_enabled IS FALSE)         AS disabled_tokens,
    count(d.onesignal_player_id) FILTER (WHERE d.enabled_synced_at IS NULL
                                           AND d.onesignal_player_id IS NOT NULL) AS unsynced_tokens
  FROM cohorts c
  LEFT JOIN public.device_tokens d ON d.user_id = c.user_id
  GROUP BY c.cohort
  ORDER BY c.cohort;
$$;

REVOKE ALL ON FUNCTION public.get_push_reach() FROM PUBLIC;

-- ── 3. pg_cron schedule (every 30 min, UTC) ─────────────────────────────────
-- Headerless net.http_post to the edge function, identical shape to the live
-- monitor-push-health job (jobid 6). The function is verify_jwt=false so no auth
-- header is needed. cron.schedule() upserts by name, so re-applying is
-- idempotent. Deploy the function with --no-verify-jwt BEFORE this schedule
-- starts firing, or early ticks 404 harmlessly until it exists.
SELECT cron.schedule(
  'sync-push-subscription-state',
  '*/30 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://upstjumasqblszevlgik.supabase.co/functions/v1/sync-push-subscription-state',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  $cron$
);

-- ── 4. Embedded self-test (aborts + rolls back on any failure) ──────────────
DO $$
DECLARE
  v_cols int;
  v_idx  int;
  v_fns  int;
  v_jobs int;
  v_rows int;
BEGIN
  SELECT count(*) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'device_tokens'
    AND column_name IN ('push_enabled', 'notification_types', 'enabled_synced_at');
  IF v_cols <> 3 THEN
    RAISE EXCEPTION 'ASSERT: expected 3 new device_tokens columns, found %', v_cols;
  END IF;

  SELECT count(*) INTO v_idx
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'idx_device_tokens_enabled_sync';
  IF v_idx <> 1 THEN
    RAISE EXCEPTION 'ASSERT: idx_device_tokens_enabled_sync missing';
  END IF;

  SELECT count(*) INTO v_fns
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_push_reach'
    AND p.prosecdef AND pg_get_function_identity_arguments(p.oid) = '';
  IF v_fns <> 1 THEN
    RAISE EXCEPTION 'ASSERT: get_push_reach missing/not SECURITY DEFINER/wrong args';
  END IF;

  SELECT count(*) INTO v_jobs
  FROM cron.job
  WHERE jobname = 'sync-push-subscription-state' AND schedule = '*/30 * * * *';
  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'ASSERT: sync-push-subscription-state cron job missing/wrong schedule';
  END IF;

  -- Live smoke: the reporting RPC must execute end to end. At author time every
  -- token is unsynced, so enabled/disabled are 0 and unsynced > 0 — but we only
  -- assert it returns cohort rows without error (shape/permissions are proven).
  SELECT count(*) INTO v_rows FROM public.get_push_reach();
  IF v_rows < 1 THEN
    RAISE EXCEPTION 'ASSERT: get_push_reach returned no cohort rows';
  END IF;

  RAISE NOTICE 'push_subscription_state_sync self-test passed';
END $$;
