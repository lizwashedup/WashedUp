-- Fictional isolated dependencies, not a complete production schema or RLS replay.
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated') $$;
CREATE TYPE public.app_role AS ENUM('admin');
CREATE TABLE profiles(id uuid PRIMARY KEY, gender text, creator_grant boolean DEFAULT false);
CREATE TABLE communities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),handle text UNIQUE,name text,description text,city text,purpose text,
 created_by uuid REFERENCES profiles(id),status text DEFAULT 'draft',join_policy text NOT NULL DEFAULT 'open',
 join_intro_question text,join_welcome_message text,guidelines_url text,creator_page_join_settings_version integer DEFAULT 0,
 join_ask_reason boolean DEFAULT false,join_ask_source boolean DEFAULT false,join_ask_rules_confirm boolean DEFAULT false,join_open_question text);
CREATE TABLE community_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),community_id uuid REFERENCES communities(id),user_id uuid REFERENCES profiles(id),role text,status text,joined_at timestamptz,UNIQUE(community_id,user_id));
CREATE TABLE community_member_answers(member_id uuid PRIMARY KEY,community_id uuid,user_id uuid,answers jsonb,updated_at timestamptz);
CREATE TABLE community_blocks(id uuid DEFAULT gen_random_uuid(),community_id uuid,block_type text,position integer);
CREATE TABLE creator_page_drafts(id uuid PRIMARY KEY);
CREATE TABLE creator_page_publications(page_id uuid PRIMARY KEY,page_kind text,audience text);
CREATE TABLE community_broadcasts(id uuid DEFAULT gen_random_uuid(),community_id uuid,sender_id uuid,body text,kind text,payload jsonb);
CREATE TABLE community_introduction_receipts(community_id uuid,user_id uuid,source_kind text,source_id uuid,PRIMARY KEY(community_id,user_id));
CREATE TABLE app_notifications(id uuid DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,actor_user_id uuid);
CREATE TABLE zip_areas(zip text,area text);
CREATE FUNCTION is_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION has_role(uuid,app_role) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION has_operator_grant(p_user uuid,p_track text) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce((SELECT creator_grant FROM public.profiles WHERE id=p_user),false) AND p_track='community_leader'$$;
-- The actual published eligibility trigger and visibility functions are replayed.
-- Their audience dependency is represented by these explicit fictional genders.
CREATE FUNCTION creator_page_audience_matches(p_audience text,p_user uuid) RETURNS boolean LANGUAGE sql AS $$SELECT coalesce((SELECT CASE p_audience WHEN 'everyone' THEN true WHEN 'women_only' THEN gender='woman' WHEN 'men_only' THEN gender='man' ELSE false END FROM public.profiles WHERE id=p_user),false)$$;
CREATE FUNCTION ensure_community_chat_layout(uuid) RETURNS void LANGUAGE sql AS $$SELECT$$;
CREATE FUNCTION emit_creator_join_notice(uuid,text,uuid,text,text) RETURNS void LANGUAGE sql AS $$SELECT$$;
INSERT INTO profiles VALUES
 ('00000000-0000-0000-0000-000000000001','woman',true),
 ('00000000-0000-0000-0000-000000000002','woman',false),
 ('00000000-0000-0000-0000-000000000003','man',false),
 ('00000000-0000-0000-0000-000000000004','woman',true),
 ('00000000-0000-0000-0000-000000000005',null,false),
 ('00000000-0000-0000-0000-000000000006','woman',false);
INSERT INTO communities(id,handle,name,status,join_policy,created_by) VALUES
 ('10000000-0000-0000-0000-000000000001','legacy','Legacy','active','open','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','published','Published','active','open','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000003','archived','Archived','archived','open','00000000-0000-0000-0000-000000000001');
INSERT INTO community_members(community_id,user_id,role,status,joined_at)
 SELECT id,created_by,'leader','active','2025-01-01' FROM communities;
INSERT INTO creator_page_publications VALUES('10000000-0000-0000-0000-000000000002','community','women_only');
CREATE FUNCTION fixture_answers() RETURNS jsonb LANGUAGE sql AS $$SELECT '{"first_name":"Example","last_name":"Person","email":"example@example.test","zip":"90026","intro_answer":"I like hiking.","guidelines_accepted":true}'::jsonb$$;
CREATE FUNCTION fixture_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END$$;
