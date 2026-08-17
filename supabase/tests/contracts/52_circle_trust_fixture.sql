\set ON_ERROR_STOP on

-- Isolated R04 fixture. Every fixture column below exists in the checked-in
-- Yours, Circles, or polymorphic-message migrations. The new attribution
-- column is intentionally absent here because the forward migration adds it.

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

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TYPE public.member_status AS ENUM ('joined', 'left', 'removed');
CREATE TYPE public.circle_role AS ENUM ('admin', 'member');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  first_name_display text,
  handle text,
  blocked_users uuid[] NOT NULL DEFAULT ARRAY[]::uuid[]
);

CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE public.people_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  can_re_request boolean NOT NULL DEFAULT true,
  context text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_connections_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'removed')),
  CONSTRAINT people_connections_context_check
    CHECK (context IN ('plan_history', 'handle_lookup', 'referral_invite')),
  CONSTRAINT people_connections_not_self
    CHECK (requester_user_id <> recipient_user_id),
  CONSTRAINT people_connections_pair_key
    UNIQUE (requester_user_id, recipient_user_id)
);

CREATE TABLE public.circles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  creator_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'forming',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.circle_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.circle_role NOT NULL DEFAULT 'member',
  status public.member_status NOT NULL DEFAULT 'joined',
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT circle_members_circle_user_key UNIQUE (circle_id, user_id)
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid,
  circle_id uuid REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  content text,
  message_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.yours_is_blocked_between(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks ub
    WHERE (ub.blocker_id = p_a AND ub.blocked_id = p_b)
       OR (ub.blocker_id = p_b AND ub.blocked_id = p_a)
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE (pr.id = p_a AND p_b = ANY(COALESCE(pr.blocked_users, ARRAY[]::uuid[])))
       OR (pr.id = p_b AND p_a = ANY(COALESCE(pr.blocked_users, ARRAY[]::uuid[])))
  );
$$;

CREATE FUNCTION public.yours_is_connected(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.people_connections pc
    WHERE pc.status = 'accepted'
      AND (
        (pc.requester_user_id = p_a AND pc.recipient_user_id = p_b)
        OR (pc.requester_user_id = p_b AND pc.recipient_user_id = p_a)
      )
  );
$$;

CREATE FUNCTION public.is_circle_member(p_circle_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id
      AND cm.user_id = p_user_id
      AND cm.status = 'joined'
  );
$$;

CREATE FUNCTION public.is_circle_admin(p_circle_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id
      AND cm.user_id = p_user_id
      AND cm.status = 'joined'
      AND cm.role = 'admin'
  );
$$;

CREATE FUNCTION public.post_circle_system_message(
  p_circle_id uuid,
  p_user_id uuid,
  p_content text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.messages (circle_id, user_id, content, message_type)
  VALUES (p_circle_id, p_user_id, p_content, 'system');
$$;

CREATE FUNCTION public.circle_display_name(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(btrim(first_name_display), ''), handle, 'Someone')
  FROM public.profiles
  WHERE id = p_user_id;
$$;

ALTER TABLE public.circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY circles_select_member ON public.circles
  FOR SELECT TO authenticated
  USING (public.is_circle_member(id, auth.uid()));

CREATE POLICY circle_members_select_member ON public.circle_members
  FOR SELECT TO authenticated
  USING (public.is_circle_member(circle_id, auth.uid()));

GRANT SELECT ON public.circles, public.circle_members TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_circle_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_circle_admin(uuid, uuid) TO authenticated;

INSERT INTO public.profiles (id, first_name_display, handle) VALUES
  ('00000000-0000-0000-0000-000000000001', 'A', 'a'),
  ('00000000-0000-0000-0000-000000000002', 'B', 'b'),
  ('00000000-0000-0000-0000-000000000003', 'C', 'c'),
  ('00000000-0000-0000-0000-000000000004', 'D', 'd'),
  ('00000000-0000-0000-0000-000000000005', 'E', 'e');

-- A knows B. B knows D. C knows E but is not in A's Circle. A and C have an
-- accepted row but are blocked, proving acceptance alone is not enough.
INSERT INTO public.people_connections
  (requester_user_id, recipient_user_id, status, context, responded_at)
VALUES
  ('00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   'accepted', 'handle_lookup', now()),
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000004',
   'accepted', 'plan_history', now()),
  ('00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000005',
   'accepted', 'referral_invite', now()),
  ('00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003',
   'accepted', 'handle_lookup', now());

INSERT INTO public.user_blocks (blocker_id, blocked_id)
VALUES ('00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000001');
