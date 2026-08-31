\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
-- PostgreSQL roles are cluster-global, while each contract lane has its own
-- database. Re-establish the production Supabase role property when a prior
-- lane created service_role without it.
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  phone text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  first_name_display text,
  onboarding_status text,
  phone_number text,
  marketing_opt_in boolean NOT NULL DEFAULT false
);
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, first_name_display, onboarding_status, phone_number)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      SPLIT_PART(NEW.raw_user_meta_data->>'full_name', ' ', 1),
      SPLIT_PART(NEW.raw_user_meta_data->>'name', ' ', 1),
      SPLIT_PART(NEW.email, '@', 1)
    ),
    'pending',
    NULLIF(NEW.phone, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
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
INSERT INTO public.profiles(id, email) VALUES
 ('14000000-0000-4000-8000-000000000001', 'one@example.com'),
 ('14000000-0000-4000-8000-000000000002', 'two@example.com');
