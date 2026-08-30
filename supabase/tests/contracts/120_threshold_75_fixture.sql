\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;

GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin');
CREATE FUNCTION public.is_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.communities (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.community_members (
  community_id uuid NOT NULL REFERENCES public.communities(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL,
  PRIMARY KEY (community_id, user_id)
);
CREATE TABLE public.community_topics (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES public.communities(id),
  archived boolean NOT NULL DEFAULT false,
  explore_event_id uuid
);
CREATE TABLE public.community_topic_members (
  topic_id uuid NOT NULL REFERENCES public.community_topics(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (topic_id, user_id)
);
CREATE TABLE public.community_topic_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.community_topics(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CONSTRAINT community_topic_messages_body_check CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.community_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id),
  sender_id uuid REFERENCES auth.users(id),
  body text NOT NULL CONSTRAINT community_broadcasts_body_check CHECK (char_length(body) BETWEEN 1 AND 4000),
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('broadcast', 'intro', 'message'))
);
CREATE TABLE public.ticket_orders (
  id uuid PRIMARY KEY,
  buyer_user_id uuid REFERENCES auth.users(id),
  status text NOT NULL,
  confirmation_email_sent_at timestamptz,
  confirmation_email_id text
);

CREATE FUNCTION public.is_topic_member(p_topic_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.community_topic_members
    WHERE topic_id = p_topic_id AND user_id = p_user_id
  )
$$;
CREATE FUNCTION public.is_community_member(p_community_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = p_community_id AND user_id = p_user_id AND status = 'active'
  )
$$;

ALTER TABLE public.community_topic_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY community_topic_messages_select ON public.community_topic_messages FOR SELECT USING (true);
CREATE POLICY community_topic_messages_insert ON public.community_topic_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND is_topic_member(topic_id, auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.community_topics t
    WHERE t.id = community_topic_messages.topic_id AND NOT t.archived
  )
);
CREATE POLICY community_topic_messages_delete ON public.community_topic_messages FOR DELETE USING (sender_id = auth.uid());

ALTER TABLE public.community_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY community_broadcasts_select ON public.community_broadcasts FOR SELECT USING (true);

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_topic_messages, public.community_broadcasts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_orders TO authenticated, service_role;
GRANT SELECT ON public.community_topics, public.community_topic_members, public.community_members TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_topic_member(uuid, uuid), public.is_community_member(uuid, uuid), public.is_admin(uuid), public.has_role(uuid, public.app_role) TO authenticated;

CREATE PUBLICATION supabase_realtime;

INSERT INTO auth.users(id) VALUES
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002');
INSERT INTO public.communities(id, name) VALUES
  ('20000000-0000-0000-0000-000000000001', 'one'),
  ('20000000-0000-0000-0000-000000000002', 'two');
INSERT INTO public.community_members(community_id, user_id, status) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'active'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'active');
INSERT INTO public.community_topics(id, community_id, archived) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', false),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', false),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', true);
INSERT INTO public.community_topic_members(topic_id, user_id) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.community_topic_messages(id, topic_id, sender_id, body) VALUES
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'topic one'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'topic two'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'archived');
INSERT INTO public.community_broadcasts(id, community_id, sender_id, body, kind) VALUES
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'main thread', 'message');
INSERT INTO public.ticket_orders(id, buyer_user_id, status) VALUES
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'paid');
