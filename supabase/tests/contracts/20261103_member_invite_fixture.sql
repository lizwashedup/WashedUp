-- Minimum dependencies for the exact exported functions, not a full schema/RLS replay.
-- All identifiers and people below are fictional. Other production side effects omitted.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE TYPE public.community_member_invite_status AS ENUM ('pending','viewed','accepted','revoked','expired');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, first_name_display text, gender text);
CREATE TABLE public.communities (id uuid PRIMARY KEY, name text, handle text, status text);
CREATE TABLE public.creator_page_publications (page_id uuid PRIMARY KEY, audience text NOT NULL);
CREATE TABLE public.community_members (
 community_id uuid REFERENCES public.communities(id), user_id uuid REFERENCES public.profiles(id),
 role text, status text, joined_at timestamptz, PRIMARY KEY(community_id,user_id)
);
CREATE TABLE public.community_member_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid REFERENCES public.communities(id),
 invited_by_user_id uuid REFERENCES public.profiles(id), target_user_id uuid REFERENCES public.profiles(id),
 token_hash text UNIQUE, status public.community_member_invite_status DEFAULT 'pending',
 expires_at timestamptz DEFAULT now()+interval '72 hours', invite_message text,
 accepted_at timestamptz, accepted_by_user_id uuid
);
INSERT INTO profiles VALUES
 ('00000000-0000-0000-0000-000000000001','Creator','woman'),
 ('00000000-0000-0000-0000-000000000002','Recipient','woman'),
 ('00000000-0000-0000-0000-000000000003','Other','man'),
 ('00000000-0000-0000-0000-000000000004','Unknown',null),
 ('00000000-0000-0000-0000-000000000005','Nonbinary','non_binary');
INSERT INTO communities VALUES ('10000000-0000-0000-0000-000000000001','Fixture community','fixture','active');
INSERT INTO creator_page_publications VALUES ('10000000-0000-0000-0000-000000000001','women_only');
CREATE FUNCTION public.fixture_invite(target uuid, token text) RETURNS uuid LANGUAGE sql AS $$
 INSERT INTO community_member_invites(community_id,invited_by_user_id,target_user_id,token_hash)
 VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',target,md5(token)) RETURNING id;
$$;
