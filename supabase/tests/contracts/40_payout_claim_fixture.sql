\set ON_ERROR_STOP on

CREATE EXTENSION dblink;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.ticket_payouts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL,
  organizer_user_id uuid NOT NULL,
  stripe_account_id_snapshot text NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL,
  failure_message text,
  stripe_payout_id text,
  released_at timestamptz,
  CONSTRAINT ticket_payouts_one_per_event UNIQUE (event_id)
);
