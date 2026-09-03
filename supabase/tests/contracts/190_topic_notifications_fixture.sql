\set ON_ERROR_STOP on

-- 75-threshold spec v2, AC-MSG-001/002/003 automated gap. Companion to
-- 120/121_threshold_75_*: those already prove archived-topic rejection and
-- edit/reply/reaction persistence; they never load app_notifications or the
-- real 20260827220000_community_topic_message_push.sql trigger, so nothing
-- anywhere previously proved (a) a caption-less photo message still pushes a
-- NONBLANK notification body, or (b) a message actually becomes readable by
-- ANOTHER member (not just the sender) the moment it lands. Kept as its own
-- lane/database rather than folded into 120/121 so it never collides with
-- concurrent edits to that existing, already-passing pair.
--
-- Schema below is deliberately minimal but verified against real production
-- (read-only introspection, 2026-09-03): community_topic_messages_select's
-- real qual and app_notifications' real column set were both pulled live via
-- `npx supabase db query --linked`, not guessed. community_topic_members
-- .notifications_on default (true) is copied from its real definition in
-- 20260702184012_communities_skeleton.sql line 228.

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

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  first_name_display text
);

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
  name text,
  archived boolean NOT NULL DEFAULT false,
  explore_event_id uuid
);
CREATE TABLE public.community_topic_members (
  topic_id uuid NOT NULL REFERENCES public.community_topics(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  notifications_on boolean NOT NULL DEFAULT true,
  PRIMARY KEY (topic_id, user_id)
);
CREATE TABLE public.community_topic_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.community_topics(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url text,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_topic_messages_body_check CHECK (
    char_length(body) <= 4000
    AND (char_length(btrim(body)) > 0 OR image_url IS NOT NULL)
  )
);

-- Real production column set for app_notifications, pulled live 2026-09-03
-- via information_schema (not guessed): id/created_at/status/push_sent/
-- push_suppressed defaults included so the trigger's own INSERT (which
-- names only user_id/type/title/body/topic_id) succeeds unmodified.
CREATE TABLE public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  event_id uuid,
  status text NOT NULL DEFAULT 'unread',
  expires_at timestamptz,
  push_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  push_suppressed boolean NOT NULL DEFAULT false,
  actor_user_id uuid,
  circle_id uuid,
  topic_id uuid
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

-- Real production community_topic_messages_select/_insert quals, pulled
-- live 2026-09-03 via pg_policies (not the simplified pre-parity version
-- 120_threshold_75_fixture.sql uses): SELECT admits any ACTIVE community
-- member, not only members who separately joined the topic itself, plus a
-- narrower branch for event-linked topics.
ALTER TABLE public.community_topic_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY community_topic_messages_select ON public.community_topic_messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.community_topics t
    WHERE t.id = community_topic_messages.topic_id
      AND is_community_member(t.community_id, (select auth.uid()))
  )
  OR EXISTS (
    SELECT 1 FROM public.community_topics t
    WHERE t.id = community_topic_messages.topic_id
      AND t.explore_event_id IS NOT NULL
      AND is_topic_member(t.id, (select auth.uid()))
  )
  OR is_admin((select auth.uid())) OR has_role((select auth.uid()), 'admin'::app_role)
);
CREATE POLICY community_topic_messages_insert ON public.community_topic_messages FOR INSERT WITH CHECK (
  sender_id = (select auth.uid())
  AND is_topic_member(topic_id, (select auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.community_topics t
    WHERE t.id = community_topic_messages.topic_id
      AND NOT t.archived
      AND (is_community_member(t.community_id, (select auth.uid())) OR t.explore_event_id IS NOT NULL)
  )
);

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT ON public.community_topics, public.community_topic_members, public.community_members, public.profiles TO authenticated;
GRANT SELECT, INSERT ON public.community_topic_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.app_notifications TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_topic_member(uuid, uuid), public.is_community_member(uuid, uuid), public.is_admin(uuid), public.has_role(uuid, public.app_role) TO authenticated;

CREATE PUBLICATION supabase_realtime;

-- Member 1: sender. Member 2: a real topic member (joined the room), should
-- be pushed. Member 3: an ordinary ACTIVE community member who never
-- separately joined this topic -- proves the read policy's community-wide
-- branch without relying on topic membership, and must NEVER be pushed a
-- room notification since they never opted into that room's pushes.
INSERT INTO auth.users(id) VALUES
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003');
INSERT INTO public.profiles(id, first_name_display) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Alex');
INSERT INTO public.communities(id, name) VALUES
  ('20000000-0000-0000-0000-000000000001', 'one');
INSERT INTO public.community_members(community_id, user_id, status) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'active'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'active'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'active');
INSERT INTO public.community_topics(id, community_id, name, archived, explore_event_id) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'general', false, NULL);
INSERT INTO public.community_topic_members(topic_id, user_id, notifications_on) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', true),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', true);
