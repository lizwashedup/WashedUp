CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE SCHEMA storage;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array($1, '/')
$$;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  first_name_display text,
  profile_photo_url text
);
CREATE TABLE public.events (
  id uuid PRIMARY KEY,
  creator_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'forming',
  circle_id uuid,
  circle_visibility text,
  start_time timestamptz NOT NULL DEFAULT now(),
  primary_vibe text
);
CREATE TABLE public.circle_members (
  circle_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL,
  PRIMARY KEY(circle_id, user_id)
);
CREATE TABLE public.blocks (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  PRIMARY KEY(blocker_id, blocked_id)
);
CREATE TABLE public.event_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  role text NOT NULL DEFAULT 'guest',
  status text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.yours_is_blocked_between(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = p_a AND blocked_id = p_b)
       OR (blocker_id = p_b AND blocked_id = p_a)
  )
$$;
CREATE TABLE public.community_topics (
  id uuid PRIMARY KEY,
  album_enabled boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false
);
CREATE TABLE public.community_topic_members (
  topic_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY(topic_id, user_id)
);
CREATE FUNCTION public.is_topic_member(p_topic uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_topic_members
    WHERE topic_id = p_topic AND user_id = p_user
  )
$$;
CREATE TABLE public.community_topic_albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL UNIQUE REFERENCES public.community_topics(id)
);
CREATE TABLE public.community_topic_album_uploads (
  id uuid PRIMARY KEY,
  topic_album_id uuid NOT NULL REFERENCES public.community_topic_albums(id),
  user_id uuid NOT NULL,
  media_url text NOT NULL,
  content_type text NOT NULL,
  media_format text NOT NULL,
  file_size_bytes bigint NOT NULL,
  video_duration_sec integer,
  deleted_at timestamptz
);

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL,
  metadata jsonb,
  UNIQUE(bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON storage.objects TO authenticated;
INSERT INTO storage.buckets(id, name, public)
VALUES ('topic-album-media', 'topic-album-media', false);
CREATE POLICY "topic members can upload to topic-album-media"
ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'topic-album-media');

CREATE TABLE public.marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
);
CREATE TABLE public.user_marks (
  user_id uuid NOT NULL,
  mark_id uuid NOT NULL REFERENCES public.marks(id),
  PRIMARY KEY(user_id, mark_id)
);

INSERT INTO public.marks(slug) VALUES
  ('night-owl'), ('early-bird'), ('trailblazer'),
  ('culture-club'), ('the-regular'), ('explorer');

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.events, public.event_members, public.profiles,
  public.circle_members, public.blocks, public.community_topics,
  public.community_topic_members TO authenticated;
GRANT EXECUTE ON FUNCTION public.yours_is_blocked_between(uuid,uuid),
  public.is_topic_member(uuid,uuid) TO authenticated;
