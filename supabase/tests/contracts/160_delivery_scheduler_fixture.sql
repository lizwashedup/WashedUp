\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY, decrypted_secret text);
CREATE SCHEMA net;
CREATE TABLE net.requests(id bigint GENERATED ALWAYS AS IDENTITY, url text, body jsonb, headers jsonb, timeout_ms integer);
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO net.requests(url, body, headers, timeout_ms)
  VALUES (url, body, headers, timeout_milliseconds) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text NOT NULL UNIQUE,
  schedule text NOT NULL,
  command text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job(jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command, active = true
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobid = p_jobid;
  RETURN FOUND;
END $$;

CREATE TABLE public.delivery_runtime_config(singleton boolean PRIMARY KEY, activation_mode text, updated_at timestamptz DEFAULT now());
INSERT INTO public.delivery_runtime_config VALUES (true, 'seed_only', now());
CREATE FUNCTION public.claim_transactional_email_jobs(integer, integer) RETURNS SETOF record LANGUAGE sql AS $$ SELECT NULL WHERE false $$;
CREATE FUNCTION public.claim_audience_sync_jobs(integer, integer) RETURNS SETOF record LANGUAGE sql AS $$ SELECT NULL WHERE false $$;
CREATE FUNCTION public.acquire_delivery_worker_lease(text, integer) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.purge_audience_personal_data(integer) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;

CREATE TABLE public.transactional_email_jobs(status text);
CREATE TABLE public.audience_sync_outbox(status text);
CREATE TABLE public.audience_contact_reconciliation(status text);
CREATE TABLE public.audience_webhook_quarantine(status text);
CREATE TABLE public.explore_event_rsvps(id integer);
CREATE TABLE public.profiles(id integer);
CREATE FUNCTION public.fixture_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER enqueue_free_rsvp_confirmation_trigger BEFORE INSERT ON public.explore_event_rsvps FOR EACH ROW EXECUTE FUNCTION public.fixture_trigger();
CREATE TRIGGER profile_consent_evidence_enqueue_trigger BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.fixture_trigger();
CREATE TRIGGER profile_consent_metadata_guard_trigger BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.fixture_trigger();
