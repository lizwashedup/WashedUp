-- Exact G0 containment and recovery operations. Run one named transaction at
-- a time after the matching protected approval. This file is never automatic.

-- RESCUE 1: stop recurring worker invocations without changing queued data.
BEGIN;
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('transactional-email-drain', 'audience-sync-drain');
COMMIT;

-- RESCUE 2: quarantine every claim path. Existing provider calls may finish,
-- but stale revision checks prevent them from overwriting newer desired state.
BEGIN;
UPDATE public.delivery_runtime_config
   SET activation_mode = 'quarantined', updated_at = now()
 WHERE singleton;
COMMIT;

-- INSPECT: counts only, no raw email or payload output.
SELECT activation_mode FROM public.delivery_runtime_config WHERE singleton;
SELECT status, count(*) FROM public.transactional_email_jobs GROUP BY status ORDER BY status;
SELECT status, count(*) FROM public.audience_sync_outbox GROUP BY status ORDER BY status;
SELECT status, count(*) FROM public.audience_contact_reconciliation GROUP BY status ORDER BY status;
SELECT status, count(*) FROM public.audience_webhook_quarantine GROUP BY status ORDER BY status;

-- RESCUE 3: contain free-RSVP enqueueing while preserving existing queue rows.
BEGIN;
ALTER TABLE public.explore_event_rsvps DISABLE TRIGGER enqueue_free_rsvp_confirmation_trigger;
COMMIT;

-- RESCUE 4: contain audience evidence/enqueueing. This leaves the BEFORE
-- metadata guard active so clients still cannot forge consent provenance.
BEGIN;
ALTER TABLE public.profiles DISABLE TRIGGER profile_consent_evidence_enqueue_trigger;
COMMIT;

-- HIGHER-RISK RESCUE 5: changing the BEFORE guard changes consent enforcement.
-- Use only with separate approval, then reconcile all profiles before enabling.
BEGIN;
ALTER TABLE public.profiles DISABLE TRIGGER profile_consent_metadata_guard_trigger;
COMMIT;

-- RESTORE: exact trigger names, each independently approved after diagnosis.
BEGIN;
ALTER TABLE public.explore_event_rsvps ENABLE TRIGGER enqueue_free_rsvp_confirmation_trigger;
ALTER TABLE public.profiles ENABLE TRIGGER profile_consent_evidence_enqueue_trigger;
ALTER TABLE public.profiles ENABLE TRIGGER profile_consent_metadata_guard_trigger;
COMMIT;
