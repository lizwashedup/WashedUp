-- Disposable PostgreSQL fixture only; NEVER run against an existing database.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public') THEN
    RAISE EXCEPTION 'Requires an empty disposable database';
  END IF;
END $$;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, blocked_users uuid[]);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.circles (id uuid PRIMARY KEY, name text);
CREATE TABLE public.circle_members (circle_id uuid, user_id uuid, status text, PRIMARY KEY (circle_id, user_id));
CREATE TABLE public.messages (id integer PRIMARY KEY, circle_id uuid, event_id uuid, user_id uuid, content text);
CREATE TABLE public.message_reactions (id integer PRIMARY KEY, message_id integer, user_id uuid, emoji text);
CREATE FUNCTION public.is_circle_member(p_circle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.circle_members WHERE circle_id = p_circle_id AND user_id = p_user_id AND status = 'joined');
$$;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
-- Deliberately permissive legacy fixture to prove the added boundary cannot
-- be bypassed through OR-combined old policies. This is not the live schema.
CREATE POLICY legacy_messages ON public.messages TO authenticated USING (true) WITH CHECK (user_id = auth.uid());
CREATE POLICY legacy_reactions ON public.message_reactions TO authenticated USING (true) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO public.profiles SELECT ('00000000-0000-0000-0000-00000000000' || n)::uuid, '{}'::uuid[] FROM generate_series(1, 4) n;
INSERT INTO public.circles VALUES
 ('10000000-0000-0000-0000-000000000001', ''),
 ('10000000-0000-0000-0000-000000000002', 'Named pair'),
 ('10000000-0000-0000-0000-000000000003', ''),
 ('10000000-0000-0000-0000-000000000004', '   ');
INSERT INTO public.circle_members SELECT c.id, p.id, 'joined' FROM public.circles c CROSS JOIN public.profiles p
 WHERE p.id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
INSERT INTO public.circle_members VALUES ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'joined');
INSERT INTO public.messages SELECT n, ('10000000-0000-0000-0000-00000000000' || n)::uuid, null,
 '00000000-0000-0000-0000-000000000001', 'Retained history' FROM generate_series(1, 4) n;
INSERT INTO public.messages VALUES (5, null, '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Event history');
INSERT INTO public.message_reactions VALUES (1, 1, '00000000-0000-0000-0000-000000000001', 'hi');
