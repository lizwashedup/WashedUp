\set ON_ERROR_STOP on

SET ROLE authenticated;
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';

INSERT INTO public.explore_event_rsvps(explore_event_id, user_id, status)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'going');

UPDATE public.explore_event_rsvps SET status = 'going'
WHERE explore_event_id = '20000000-0000-0000-0000-000000000001'
  AND user_id = '10000000-0000-0000-0000-000000000001';
UPDATE public.explore_event_rsvps SET status = 'cancelled'
WHERE explore_event_id = '20000000-0000-0000-0000-000000000001'
  AND user_id = '10000000-0000-0000-0000-000000000001';
UPDATE public.explore_event_rsvps SET status = 'going'
WHERE explore_event_id = '20000000-0000-0000-0000-000000000001'
  AND user_id = '10000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.transactional_email_jobs) <> 0 THEN
    RAISE EXCEPTION 'authenticated users can read the protected delivery outbox';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END $$;

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.transactional_email_jobs
      WHERE idempotency_key = 'free-rsvp/20000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'repeated RSVP state created a duplicate confirmation job';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactional_email_jobs'
      AND column_name IN ('email', 'subject', 'html', 'body')
  ) THEN
    RAISE EXCEPTION 'delivery outbox stores raw destination or message content';
  END IF;
END $$;

INSERT INTO public.transactional_email_jobs(kind, idempotency_key, user_id, explore_event_id, status, attempts, available_at)
SELECT 'free_event_rsvp', 'fixture-fresh-' || n,
       ('10000000-0000-0000-0000-00000000000' || (n + 1))::uuid,
       '20000000-0000-0000-0000-000000000001', 'pending', 0, now()
FROM generate_series(1, 3) n;
INSERT INTO public.transactional_email_jobs(kind, idempotency_key, user_id, explore_event_id, status, attempts, available_at)
SELECT 'free_event_rsvp', 'fixture-retry-' || n,
       ('10000000-0000-0000-0000-00000000000' || (n + 3))::uuid,
       '20000000-0000-0000-0000-000000000001', 'pending', 1, now()
FROM generate_series(1, 3) n;

DO $$ BEGIN
  IF (SELECT activation_mode FROM public.delivery_runtime_config WHERE singleton) IS DISTINCT FROM 'quarantined' THEN
    RAISE EXCEPTION 'transactional delivery did not default to quarantine';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_transactional_email_jobs(10, 300)) THEN
    RAISE EXCEPTION 'quarantined transactional queue claimed work';
  END IF;
END $$;

INSERT INTO public.delivery_seed_profiles(profile_id)
VALUES ('10000000-0000-0000-0000-000000000002');
UPDATE public.delivery_runtime_config SET activation_mode = 'seed_only' WHERE singleton;
CREATE TEMP TABLE seed_transactional_claim AS
SELECT * FROM public.claim_transactional_email_jobs(10, 300);
DO $$ BEGIN
  IF (SELECT count(*) FROM seed_transactional_claim) <> 1
     OR (SELECT user_id FROM seed_transactional_claim) IS DISTINCT FROM '10000000-0000-0000-0000-000000000002'::uuid THEN
    RAISE EXCEPTION 'seed-only transactional claim escaped its approved profile';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactional_email_jobs
     WHERE user_id = '10000000-0000-0000-0000-000000000003' AND status = 'pending'
  ) THEN RAISE EXCEPTION 'seed-only transactional claim touched real work'; END IF;
END $$;
UPDATE public.transactional_email_jobs
   SET status = 'pending', attempts = attempts - 1, claimed_at = NULL
 WHERE id IN (SELECT id FROM seed_transactional_claim);
UPDATE public.delivery_runtime_config SET activation_mode = 'live' WHERE singleton;

CREATE TEMP TABLE claimed AS
SELECT * FROM public.claim_transactional_email_jobs(4, 300);

DO $$
BEGIN
  IF (SELECT count(*) FROM claimed) <> 4 THEN
    RAISE EXCEPTION 'claim did not return the requested batch size';
  END IF;
  IF (SELECT count(*) FROM claimed WHERE attempts = 1) <> 2 THEN
    RAISE EXCEPTION 'fresh jobs did not receive two reserved claim slots';
  END IF;
  IF (SELECT count(*) FROM claimed WHERE attempts = 2) <> 2 THEN
    RAISE EXCEPTION 'retry jobs did not receive two reserved claim slots';
  END IF;
END $$;

UPDATE public.transactional_email_jobs
SET status = 'failed', last_error = 'fixture terminal failure'
WHERE id = (SELECT min(id) FROM claimed);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.transactional_email_jobs WHERE status = 'failed' AND last_error IS NOT NULL) THEN
    RAISE EXCEPTION 'terminal delivery failure is not queryable';
  END IF;
  RAISE NOTICE 'PASS: durable free RSVP delivery outbox, idempotency, privacy, fairness, and failure visibility';
END $$;
