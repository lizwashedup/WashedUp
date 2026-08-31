\set ON_ERROR_STOP on
SET ROLE authenticated;
UPDATE public.profiles SET marketing_opt_in = true, marketing_opt_in_source = 'signup'
 WHERE id = '14000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET marketing_opt_in = false WHERE id = '14000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET email = 'new@example.com', marketing_opt_in = true WHERE id = '14000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET marketing_opt_in = false WHERE id = '14000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET marketing_opt_in = true WHERE id = '14000000-0000-4000-8000-000000000001';
RESET ROLE;
SET ROLE authenticated;
INSERT INTO public.profiles(id, email, marketing_opt_in) VALUES
  ('14000000-0000-4000-8000-000000000003', 'signup@example.com', true),
  ('14000000-0000-4000-8000-000000000004', 'real@example.com', true),
  ('14000000-0000-4000-8000-000000000005', 'seed@example.com', true),
  ('14000000-0000-4000-8000-000000000006', 'reversible@example.com', true),
  ('14000000-0000-4000-8000-000000000007', 'quarantine@example.com', true);
RESET ROLE;
INSERT INTO auth.users(id, email, phone, raw_user_meta_data) VALUES (
  '14000000-0000-4000-8000-000000000008',
  NULL,
  '+12025550100',
  '{}'::jsonb
);
SET ROLE service_role;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.audience_consent_events WHERE profile_id = '14000000-0000-4000-8000-000000000001') < 3 THEN RAISE EXCEPTION 'consent evidence missing'; END IF;
  IF (SELECT desired_marketing_opt_in FROM public.audience_sync_outbox WHERE normalized_email = 'one@example.com') IS DISTINCT FROM false THEN RAISE EXCEPTION 'old email unsubscribe missing'; END IF;
  IF (SELECT desired_marketing_opt_in FROM public.audience_sync_outbox WHERE normalized_email = 'new@example.com') IS DISTINCT FROM true THEN RAISE EXCEPTION 'new email desired state missing'; END IF;
  IF (SELECT max(revision) FROM public.audience_sync_outbox WHERE normalized_email = 'new@example.com') < 2 THEN RAISE EXCEPTION 'coalesced revision did not advance'; END IF;
  IF EXISTS (SELECT 1 FROM public.audience_consent_events WHERE consent_source = 'signup') THEN RAISE EXCEPTION 'client spoofed consent source'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name IN ('audience_consent_events','audience_suppression_events') AND column_name IN ('email','normalized_email')) THEN RAISE EXCEPTION 'raw email evidence column present'; END IF;
  IF (SELECT count(*) FROM public.audience_consent_events WHERE profile_id = '14000000-0000-4000-8000-000000000003') <> 1 THEN RAISE EXCEPTION 'real signup did not create exactly one consent evidence row'; END IF;
  IF (SELECT count(*) FROM public.audience_sync_outbox WHERE profile_id = '14000000-0000-4000-8000-000000000003' AND normalized_email = 'signup@example.com') <> 1 THEN RAISE EXCEPTION 'real signup did not create exactly one desired-state row'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = '14000000-0000-4000-8000-000000000008'
       AND email IS NULL
       AND phone_number = '+12025550100'
       AND onboarding_status = 'pending'
  ) THEN RAISE EXCEPTION 'phone-only auth signup did not create its profile'; END IF;
  IF (SELECT count(*) FROM public.audience_consent_events
       WHERE profile_id = '14000000-0000-4000-8000-000000000008'
         AND email_hash IS NULL
         AND email_consent = false) <> 1 THEN
    RAISE EXCEPTION 'phone-only auth signup did not create null-email consent evidence';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audience_sync_outbox
     WHERE profile_id = '14000000-0000-4000-8000-000000000008'
  ) THEN RAISE EXCEPTION 'phone-only auth signup incorrectly queued an email job'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profile_consent_metadata_guard_trigger' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'profile_consent_evidence_enqueue_trigger' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'split consent triggers are not active';
  END IF;
  IF (SELECT activation_mode FROM public.delivery_runtime_config WHERE singleton) IS DISTINCT FROM 'quarantined' THEN RAISE EXCEPTION 'delivery did not default to quarantine'; END IF;
  IF EXISTS (SELECT 1 FROM public.claim_audience_sync_jobs(10, 600)) THEN RAISE EXCEPTION 'quarantined audience queue claimed real work'; END IF;
  IF EXISTS (SELECT 1 FROM public.claim_transactional_email_jobs(10, 300)) THEN RAISE EXCEPTION 'quarantined transactional queue claimed work'; END IF;
END $$;

INSERT INTO public.delivery_seed_profiles(profile_id)
VALUES ('14000000-0000-4000-8000-000000000005');
UPDATE public.delivery_runtime_config SET activation_mode = 'seed_only' WHERE singleton;
CREATE TEMP TABLE seed_claim AS SELECT * FROM public.claim_audience_sync_jobs(10, 600);
DO $$ BEGIN
  IF (SELECT count(*) FROM seed_claim) <> 1
     OR (SELECT profile_id FROM seed_claim) IS DISTINCT FROM '14000000-0000-4000-8000-000000000005'::uuid THEN
    RAISE EXCEPTION 'seed-only audience claim escaped its approved profile';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audience_sync_outbox WHERE profile_id = '14000000-0000-4000-8000-000000000004' AND status = 'pending') THEN
    RAISE EXCEPTION 'seed-only claim touched a real profile';
  END IF;
END $$;
UPDATE public.audience_sync_outbox SET status = 'delivered', terminal_at = now(), purge_after = now() + interval '30 days'
 WHERE id IN (SELECT id FROM seed_claim);

DO $$
DECLARE v_token uuid;
BEGIN
  v_token := public.acquire_delivery_worker_lease('audience_sync', 300);
  IF v_token IS NULL THEN RAISE EXCEPTION 'first worker lease was rejected'; END IF;
  IF public.acquire_delivery_worker_lease('audience_sync', 300) IS NOT NULL THEN RAISE EXCEPTION 'overlapping worker lease was accepted'; END IF;
  IF public.release_delivery_worker_lease('audience_sync', gen_random_uuid()) THEN RAISE EXCEPTION 'wrong lease token released worker'; END IF;
  IF NOT public.release_delivery_worker_lease('audience_sync', v_token) THEN RAISE EXCEPTION 'correct lease token did not release worker'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT marketing_opt_in_source FROM public.profiles WHERE id = '14000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'profile_change' THEN RAISE EXCEPTION 'trusted profile source missing'; END IF;
  IF has_table_privilege('authenticated', 'public.audience_sync_outbox', 'SELECT') THEN RAISE EXCEPTION 'outbox readable by authenticated'; END IF;
  IF NOT has_table_privilege('service_role', 'public.audience_sync_outbox', 'SELECT') THEN RAISE EXCEPTION 'service role cannot read outbox'; END IF;
END $$;
SET ROLE service_role;
INSERT INTO public.delivery_seed_profiles(profile_id)
VALUES ('14000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
SELECT public.enqueue_current_profile_audience_sync('14000000-0000-4000-8000-000000000001');
SELECT public.record_audience_provider_event(
  'provider-1', 'email.bounced', 'NEW@example.com',
  NULL, NULL, 'washedup-audience', NULL, 'washedup', true
);
SELECT public.record_audience_provider_event(
  'provider-1', 'email.bounced', 'new@example.com',
  NULL, NULL, 'washedup-audience', NULL, 'washedup', true
);
DO $$ BEGIN
  IF has_function_privilege('service_role', 'public.record_audience_suppression(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service role can bypass provider-event hard-suppression classification';
  END IF;
END $$;
RESET ROLE;
SET ROLE authenticated;
UPDATE public.profiles SET marketing_opt_in = true, marketing_opt_in_source = 'forged-reopt-in'
 WHERE id = '14000000-0000-4000-8000-000000000001';
RESET ROLE;
SET ROLE service_role;
DO $$
DECLARE v_revision bigint;
BEGIN
  SELECT revision INTO v_revision FROM public.audience_sync_outbox
   WHERE normalized_email = 'new@example.com';
  UPDATE public.audience_sync_outbox SET status = 'failed', attempts = 9
   WHERE normalized_email = 'new@example.com';
  PERFORM public.enqueue_current_profile_audience_sync('14000000-0000-4000-8000-000000000001');
  IF NOT EXISTS (
    SELECT 1 FROM public.audience_sync_outbox
     WHERE normalized_email = 'new@example.com'
       AND status = 'pending' AND attempts = 0 AND revision > v_revision
  ) THEN
    RAISE EXCEPTION 'same-state failed job was not safely requeued';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.audience_suppression_events) <> 1 THEN RAISE EXCEPTION 'suppression replay duplicated'; END IF;
  IF (SELECT marketing_opt_in FROM public.profiles WHERE email = 'new@example.com') THEN RAISE EXCEPTION 'suppression did not disable marketing opt-in'; END IF;
  IF (SELECT desired_marketing_opt_in FROM public.audience_sync_outbox WHERE normalized_email = 'new@example.com') THEN RAISE EXCEPTION 'suppressed email was re-subscribed'; END IF;
  IF (SELECT marketing_opt_in_source FROM public.profiles WHERE email = 'new@example.com') IS DISTINCT FROM 'provider_hard_suppression' THEN RAISE EXCEPTION 'hard suppression source was not preserved'; END IF;
END $$;

SET ROLE service_role;
DO $$ BEGIN
  IF public.record_audience_provider_event(
    'contact-unscoped', 'contact.updated', 'reversible@example.com',
    'contact-1', 'wrong-audience', 'washedup-audience'
  ) IS DISTINCT FROM 'quarantined' THEN
    RAISE EXCEPTION 'unscoped contact event was not quarantined';
  END IF;
  IF public.record_audience_provider_event(
    'hard-unscoped', 'email.complained', 'quarantine@example.com',
    NULL, NULL, 'washedup-audience', 'unknown-message', NULL, false
  ) IS DISTINCT FROM 'quarantined' THEN
    RAISE EXCEPTION 'unscoped hard event was not quarantined';
  END IF;
  IF public.record_audience_provider_event(
    'bounce-transient', 'email.bounced', 'quarantine@example.com',
    NULL, NULL, 'washedup-audience', 'transient-message', 'washedup', false
  ) IS DISTINCT FROM 'quarantined' THEN
    RAISE EXCEPTION 'transient bounce was not quarantined';
  END IF;
  IF public.record_audience_provider_event(
    'hard-real-seedonly', 'email.complained', 'real@example.com',
    NULL, NULL, 'washedup-audience', NULL, 'washedup', false
  ) IS DISTINCT FROM 'quarantined' THEN
    RAISE EXCEPTION 'seed-only activation accepted a real-profile hard event';
  END IF;
  IF NOT (SELECT marketing_opt_in FROM public.profiles WHERE id = '14000000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'seed-only hard event changed a real profile';
  END IF;
  IF public.record_audience_provider_event(
    'contact-old', 'contact.updated', 'reversible@example.com',
    'contact-1', 'washedup-audience', 'washedup-audience'
  ) IS DISTINCT FROM 'reconciliation_queued' THEN
    RAISE EXCEPTION 'scoped contact event was not queued for reconciliation';
  END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
UPDATE public.profiles SET marketing_opt_in = false
 WHERE id = '14000000-0000-4000-8000-000000000006';
UPDATE public.profiles SET marketing_opt_in = true
 WHERE id = '14000000-0000-4000-8000-000000000006';
RESET ROLE;

SET ROLE service_role;
INSERT INTO public.delivery_seed_profiles(profile_id)
VALUES ('14000000-0000-4000-8000-000000000006') ON CONFLICT DO NOTHING;
CREATE TEMP TABLE old_contact_claim AS
  SELECT * FROM public.claim_audience_contact_reconciliations(10, 600);
DO $$
DECLARE v_id bigint;
BEGIN
  SELECT id INTO v_id FROM old_contact_claim WHERE provider_event_id = 'contact-old';
  IF v_id IS NULL THEN RAISE EXCEPTION 'seed-scoped contact reconciliation was not claimed'; END IF;
  IF public.complete_audience_contact_reconciliation(
    v_id, true, 'washedup-audience', true, NULL
  ) THEN RAISE EXCEPTION 'older unsubscribe event overrode newer re-consent'; END IF;
  IF NOT (SELECT marketing_opt_in FROM public.profiles WHERE id = '14000000-0000-4000-8000-000000000006') THEN
    RAISE EXCEPTION 'newer re-consent was lost';
  END IF;
  IF (SELECT status FROM public.audience_contact_reconciliation WHERE id = v_id) <> 'cancelled' THEN
    RAISE EXCEPTION 'stale contact event was not terminally cancelled';
  END IF;
END $$;
DO $$ BEGIN
  IF public.record_audience_provider_event(
    'contact-current', 'contact.updated', 'reversible@example.com',
    'contact-1', 'washedup-audience', 'washedup-audience'
  ) IS DISTINCT FROM 'reconciliation_queued' THEN
    RAISE EXCEPTION 'current contact event was not queued';
  END IF;
END $$;
CREATE TEMP TABLE current_contact_claim AS
  SELECT * FROM public.claim_audience_contact_reconciliations(10, 600);
DO $$
DECLARE v_id bigint;
BEGIN
  SELECT id INTO v_id FROM current_contact_claim WHERE provider_event_id = 'contact-current';
  IF v_id IS NULL THEN RAISE EXCEPTION 'current contact reconciliation was not claimed'; END IF;
  IF NOT public.complete_audience_contact_reconciliation(
    v_id, false, 'washedup-audience', true, NULL
  ) THEN RAISE EXCEPTION 'confirmed subscribed provider state was rejected'; END IF;
  IF NOT (SELECT marketing_opt_in FROM public.profiles WHERE id = '14000000-0000-4000-8000-000000000006') THEN
    RAISE EXCEPTION 'provider subscribed convergence disabled local consent';
  END IF;
  IF (SELECT count(*) FROM public.audience_webhook_quarantine) <> 4 THEN
    RAISE EXCEPTION 'unscoped webhook quarantine count drifted';
  END IF;
END $$;

INSERT INTO public.delivery_seed_profiles(profile_id)
VALUES ('14000000-0000-4000-8000-000000000007') ON CONFLICT DO NOTHING;
INSERT INTO public.explore_events(id) VALUES ('24000000-0000-4000-8000-000000000001');
INSERT INTO public.transactional_email_jobs(
  kind, idempotency_key, user_id, explore_event_id, status,
  attempts, provider_message_id, delivered_at, available_at
) VALUES (
  'free_event_rsvp', 'quarantine-receipt',
  '14000000-0000-4000-8000-000000000007',
  '24000000-0000-4000-8000-000000000001', 'delivered',
  1, 'unknown-message', now(), NULL
), (
  'free_event_rsvp', 'transient-receipt',
  '14000000-0000-4000-8000-000000000007',
  '24000000-0000-4000-8000-000000000001', 'delivered',
  1, 'transient-message', now(), NULL
);
DO $$ BEGIN
  IF public.reconcile_quarantined_audience_events(10) <> 1 THEN
    RAISE EXCEPTION 'quarantined event did not resolve after send receipt appeared';
  END IF;
  IF (SELECT status FROM public.audience_webhook_quarantine WHERE provider_event_id = 'hard-unscoped') <> 'resolved' THEN
    RAISE EXCEPTION 'reconciled webhook did not leave a resolved receipt';
  END IF;
  IF (SELECT status FROM public.audience_webhook_quarantine WHERE provider_event_id = 'bounce-transient') <> 'pending'
     OR (SELECT hard_eligible FROM public.audience_webhook_quarantine WHERE provider_event_id = 'bounce-transient') THEN
    RAISE EXCEPTION 'transient bounce became a hard suppression after receipt reconciliation';
  END IF;
  IF (SELECT marketing_opt_in FROM public.profiles WHERE id = '14000000-0000-4000-8000-000000000007') THEN
    RAISE EXCEPTION 'reconciled hard suppression did not disable marketing';
  END IF;
END $$;
RESET ROLE;
UPDATE public.delivery_runtime_config SET activation_mode = 'live' WHERE singleton;
SET ROLE service_role;
DO $$ BEGIN
  CREATE TEMP TABLE claimed_audience AS SELECT * FROM public.claim_audience_sync_jobs(10, 300);
  IF (SELECT count(*) FROM claimed_audience) < 2 THEN RAISE EXCEPTION 'claim did not reserve jobs'; END IF;
  IF public.complete_audience_sync_job((SELECT id FROM claimed_audience LIMIT 1),
      (SELECT revision - 1 FROM claimed_audience LIMIT 1), 'succeeded', true) THEN
    RAISE EXCEPTION 'stale completion was accepted';
  END IF;
  UPDATE public.audience_sync_outbox SET status = 'processing'
   WHERE id = (SELECT id FROM claimed_audience LIMIT 1);
  IF NOT public.complete_audience_sync_job((SELECT id FROM claimed_audience LIMIT 1),
      (SELECT revision FROM claimed_audience LIMIT 1), 'retryable', false, 'fixture retry') THEN
    RAISE EXCEPTION 'retryable completion was rejected';
  END IF;
  IF NOT public.complete_audience_sync_job((SELECT id FROM claimed_audience OFFSET 1 LIMIT 1),
      (SELECT revision FROM claimed_audience OFFSET 1 LIMIT 1), 'succeeded', true) THEN
    RAISE EXCEPTION 'confirmed completion was rejected';
  END IF;
END $$;
RESET ROLE;
DO $$
DECLARE
  v_id bigint;
  v_old_revision bigint;
  v_new_revision bigint;
BEGIN
  PERFORM public.enqueue_audience_sync_for_email('race@example.com', true);
  SELECT id, revision INTO v_id, v_old_revision
    FROM public.audience_sync_outbox WHERE normalized_email = 'race@example.com';
  UPDATE public.audience_sync_outbox
     SET status = 'processing', attempts = 1, claimed_at = now()
   WHERE id = v_id;
  PERFORM public.enqueue_audience_sync_for_email('race@example.com', false);
  SELECT revision INTO v_new_revision FROM public.audience_sync_outbox WHERE id = v_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.audience_sync_outbox
     WHERE id = v_id AND revision = v_new_revision
       AND desired_marketing_opt_in = false AND status = 'processing'
       AND claimed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'new desired state escaped the active claim';
  END IF;
  IF public.complete_audience_sync_job(v_id, v_old_revision, 'succeeded', true) THEN
    RAISE EXCEPTION 'stale race completion was accepted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audience_sync_outbox
     WHERE id = v_id AND desired_marketing_opt_in = false
       AND status = 'pending' AND attempts = 0 AND revision = v_new_revision
  ) THEN
    RAISE EXCEPTION 'stale completion did not atomically requeue newest desired state';
  END IF;
  UPDATE public.audience_sync_outbox SET status = 'processing' WHERE id = v_id;
  IF NOT public.complete_audience_sync_job(v_id, v_new_revision, 'succeeded', true) THEN
    RAISE EXCEPTION 'reconciled race completion was rejected';
  END IF;
END $$;
DO $$
DECLARE
  v_id bigint;
  v_revision bigint;
BEGIN
  PERFORM public.enqueue_audience_sync_for_email('lease@example.com', true);
  SELECT id, revision INTO v_id, v_revision
    FROM public.audience_sync_outbox WHERE normalized_email = 'lease@example.com';
  UPDATE public.audience_sync_outbox
     SET status = 'processing', attempts = 1, claimed_at = now()
   WHERE id = v_id;
  PERFORM public.enqueue_audience_sync_for_email('lease@example.com', false);
  SELECT revision INTO v_revision FROM public.audience_sync_outbox WHERE id = v_id;
  IF (SELECT status FROM public.audience_sync_outbox WHERE id = v_id) <> 'processing' THEN
    RAISE EXCEPTION 'desired update did not remain serialized behind active lease';
  END IF;
  UPDATE public.audience_sync_outbox SET status = 'delivered' WHERE id <> v_id;
  UPDATE public.audience_sync_outbox
     SET claimed_at = now() - interval '601 seconds'
   WHERE id = v_id;
  CREATE TEMP TABLE expired_audience_claim AS
    SELECT * FROM public.claim_audience_sync_jobs(1, 600);
  IF NOT EXISTS (
    SELECT 1 FROM expired_audience_claim
     WHERE id = v_id AND revision = v_revision
       AND desired_marketing_opt_in = false AND status = 'processing'
  ) THEN
    RAISE EXCEPTION 'expired claim did not recover the newest desired state';
  END IF;
  IF NOT public.complete_audience_sync_job(v_id, v_revision, 'succeeded', true) THEN
    RAISE EXCEPTION 'lease-recovered completion was rejected';
  END IF;
END $$;
RESET ROLE;
SELECT 'PASS consent source, evidence, coalescing, email-change unsubscribe, suppression replay, RLS, claim, and transactional separation' AS result;
