\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TYPE public.community_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE public.community_member_role AS ENUM
  ('leader', 'co_leader', 'admin', 'events', 'member_care', 'finance', 'member');
CREATE TYPE public.community_member_status AS ENUM
  ('pending', 'active', 'left', 'removed', 'banned', 'declined');

CREATE TABLE public.communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL UNIQUE,
  name text NOT NULL,
  status public.community_status NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES auth.users(id),
  join_policy text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.community_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.community_member_role NOT NULL DEFAULT 'member',
  status public.community_member_status NOT NULL DEFAULT 'pending',
  joined_at timestamptz,
  UNIQUE (community_id, user_id)
);

CREATE TABLE public.community_member_answers (
  member_id uuid PRIMARY KEY REFERENCES public.community_members(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answers jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.community_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  is_default boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX community_topics_one_default
  ON public.community_topics (community_id) WHERE is_default;

CREATE TABLE public.community_topic_members (
  topic_id uuid NOT NULL REFERENCES public.community_topics(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, user_id)
);
CREATE TABLE public.community_topic_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.community_topics(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id),
  body text NOT NULL
);
CREATE TABLE public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id)
);

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
CREATE POLICY communities_select ON public.communities FOR SELECT TO authenticated USING (true);
CREATE POLICY communities_update ON public.communities FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id = communities.id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('admin', 'member_care')
        AND cm.status = 'active'
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id = communities.id
        AND cm.user_id = auth.uid()
        AND cm.role IN ('admin', 'member_care')
        AND cm.status = 'active'
    )
  );
GRANT SELECT, UPDATE ON public.communities TO authenticated;
GRANT SELECT ON public.community_members TO authenticated;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000006');

-- Five rows mirror the observed live count and are all present before the
-- migration. Their policy values and default must remain untouched.
INSERT INTO public.communities (id, handle, name, status, created_by)
SELECT
  ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'existing-' || n,
  'Existing ' || n,
  'active',
  '00000000-0000-0000-0000-000000000001'
FROM generate_series(1, 5) AS n;

INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
SELECT id, '00000000-0000-0000-0000-000000000001', 'leader', 'active', now()
FROM public.communities;

INSERT INTO public.community_members (community_id, user_id, role, status, joined_at)
VALUES (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'admin',
  'active',
  now()
), (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  'member_care',
  'active',
  now()
), (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
  'events',
  'active',
  now()
), (
  '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000006',
  'co_leader',
  'active',
  now()
);
