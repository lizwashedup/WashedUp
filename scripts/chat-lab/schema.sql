-- LOCAL TEST FIXTURE ONLY. Not an application migration.
-- Adapted from 190_topic_notifications_fixture.sql. Uses real local Auth,
-- PostgREST and Realtime; no notification tables, triggers or external calls.
-- This is a scoped policy fixture, not a replay of the full production schema.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public') THEN
  RAISE EXCEPTION 'Chat lab requires a fresh database with no public tables';
 END IF;
END $$;
CREATE TABLE public.chat_lab_marker (id text PRIMARY KEY CHECK(id='washedup-local-chat-lab-v1'));
INSERT INTO public.chat_lab_marker VALUES ('washedup-local-chat-lab-v1');
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
  edited_at timestamptz,
  reply_to_message_id uuid,
  location_lat double precision,
  location_lng double precision,
  mention_data jsonb,
  CONSTRAINT community_topic_messages_body_check CHECK (
    char_length(body) <= 4000
    AND (char_length(btrim(body)) > 0 OR image_url IS NOT NULL)
  )
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

-- Policy expressions copied from the repository's 190 fixture, whose provenance
-- records a 2026-09-03 pg_policies snapshot. This lab did not query current
-- production policies. SELECT admits any ACTIVE community
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
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  CREATE PUBLICATION supabase_realtime;
 END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.community_topic_messages;
NOTIFY pgrst, 'reload schema';
COMMIT;
