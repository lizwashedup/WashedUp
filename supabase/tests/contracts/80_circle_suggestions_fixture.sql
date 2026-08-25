\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;

CREATE TYPE public.member_status AS ENUM ('joined', 'left', 'removed');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  first_name_display text,
  handle text,
  profile_photo_url text
);

CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE FUNCTION public.yours_is_blocked_between(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks
    WHERE (blocker_id = p_a AND blocked_id = p_b)
       OR (blocker_id = p_b AND blocked_id = p_a)
  )
$$;

CREATE TABLE public.event_members (
  event_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.member_status NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE public.circles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE public.circle_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status public.member_status NOT NULL DEFAULT 'joined',
  UNIQUE (circle_id, user_id)
);

CREATE TABLE public.circle_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  suggested_user_ids uuid[] NOT NULL DEFAULT '{}',
  shared_event_ids uuid[] NOT NULL DEFAULT '{}',
  basis text NOT NULL DEFAULT 'co_attendance',
  score numeric,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dismissed', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.circle_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY circle_suggestions_select_own ON public.circle_suggestions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.circle_suggestions TO authenticated;

INSERT INTO public.profiles (id, first_name_display, handle) VALUES
  ('00000000-0000-0000-0000-000000000001', 'A', 'a'),
  ('00000000-0000-0000-0000-000000000002', 'B', 'b'),
  ('00000000-0000-0000-0000-000000000003', 'C', 'c'),
  ('00000000-0000-0000-0000-000000000004', 'D', 'd'),
  ('00000000-0000-0000-0000-000000000005', 'E', 'e'),
  ('00000000-0000-0000-0000-000000000006', 'F', 'f'),
  ('00000000-0000-0000-0000-000000000007', 'G', 'g');

-- A/B/C have the same exact joined roster on three plans. A fourth plan adds
-- G, proving overlapping membership does not count toward the exact-set rule.
INSERT INTO public.event_members (event_id, user_id, status)
SELECT event_id, user_id, 'joined'::public.member_status
FROM unnest(ARRAY[
  '10000000-0000-0000-0000-000000000001'::uuid,
  '10000000-0000-0000-0000-000000000002'::uuid,
  '10000000-0000-0000-0000-000000000003'::uuid
]) AS event(event_id)
CROSS JOIN unnest(ARRAY[
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid
]) AS person(user_id);

INSERT INTO public.event_members (event_id, user_id, status)
SELECT '10000000-0000-0000-0000-000000000004', user_id, 'joined'
FROM unnest(ARRAY[
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000007'::uuid
]) AS person(user_id);

-- D/E/F also recur three times, but already have an exact Circle together.
INSERT INTO public.event_members (event_id, user_id, status)
SELECT event_id, user_id, 'joined'::public.member_status
FROM unnest(ARRAY[
  '20000000-0000-0000-0000-000000000001'::uuid,
  '20000000-0000-0000-0000-000000000002'::uuid,
  '20000000-0000-0000-0000-000000000003'::uuid
]) AS event(event_id)
CROSS JOIN unnest(ARRAY[
  '00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000005'::uuid,
  '00000000-0000-0000-0000-000000000006'::uuid
]) AS person(user_id);

WITH new_circle AS (
  INSERT INTO public.circles (name) VALUES ('existing exact circle') RETURNING id
)
INSERT INTO public.circle_members (circle_id, user_id)
SELECT new_circle.id, person.user_id
FROM new_circle
CROSS JOIN unnest(ARRAY[
  '00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000005'::uuid,
  '00000000-0000-0000-0000-000000000006'::uuid
]) AS person(user_id);
