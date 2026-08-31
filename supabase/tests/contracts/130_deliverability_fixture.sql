\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text
);
CREATE TABLE public.explore_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  event_date text,
  venue text,
  confirmation_message text
);
CREATE TABLE public.explore_event_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  explore_event_id uuid NOT NULL REFERENCES public.explore_events(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL CHECK (status IN ('going', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (explore_event_id, user_id)
);

GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.explore_event_rsvps TO authenticated;
GRANT SELECT ON public.profiles, public.explore_events TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;

INSERT INTO auth.users(id) VALUES
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000004'),
  ('10000000-0000-0000-0000-000000000005'),
  ('10000000-0000-0000-0000-000000000006');
INSERT INTO public.profiles(id, email)
SELECT id, 'person-' || right(id::text, 2) || '@example.com' FROM auth.users;
INSERT INTO public.explore_events(id, title, event_date, venue, confirmation_message) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Free picnic', 'Friday', 'Elysian Park', 'Bring a blanket');
