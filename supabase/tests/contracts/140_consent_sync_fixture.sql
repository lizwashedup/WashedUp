\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- PostgreSQL roles are cluster-global, while each contract lane has its own
-- database. Re-establish the production Supabase role property when a prior
-- lane created service_role without it.
ALTER ROLE service_role BYPASSRLS;
CREATE TABLE auth_users_fixture (id uuid PRIMARY KEY);
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, marketing_opt_in boolean NOT NULL DEFAULT false);
CREATE TABLE public.explore_events (id uuid PRIMARY KEY);
CREATE TABLE public.explore_event_rsvps (
  explore_event_id uuid NOT NULL REFERENCES public.explore_events(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  status text NOT NULL,
  PRIMARY KEY (explore_event_id, user_id)
);
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.explore_events, public.explore_event_rsvps TO service_role;
INSERT INTO public.profiles VALUES
 ('14000000-0000-4000-8000-000000000001', 'one@example.com'),
 ('14000000-0000-4000-8000-000000000002', 'two@example.com');
