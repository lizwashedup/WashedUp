-- Local-only extension after the direct-table block tests. Never run live.
-- Match the columns used by the exact five live RPC bodies; synthetic data only.
DROP POLICY private_chat_reaction_select ON message_reactions;
DROP POLICY private_chat_reaction_insert ON message_reactions;
DROP POLICY private_chat_reaction_update ON message_reactions;
ALTER TABLE messages ALTER COLUMN id TYPE uuid USING ('30000000-0000-0000-0000-' || lpad(id::text,12,'0'))::uuid;
ALTER TABLE message_reactions ALTER COLUMN message_id TYPE uuid USING ('30000000-0000-0000-0000-' || lpad(message_id::text,12,'0'))::uuid;
ALTER TABLE profiles ADD COLUMN first_name_display text DEFAULT 'Fixture';
ALTER TABLE profiles ADD COLUMN last_name text;
ALTER TABLE profiles ADD COLUMN handle text;
ALTER TABLE profiles ADD COLUMN profile_photo_url text DEFAULT 'https://example.invalid/fixture.jpg';
ALTER TABLE profiles ADD COLUMN suspended_until timestamptz;
ALTER TABLE circles ADD COLUMN status text DEFAULT 'active';
ALTER TABLE circles ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE circle_members ADD COLUMN role text DEFAULT 'member';
ALTER TABLE circle_members ADD COLUMN joined_at timestamptz DEFAULT now();
ALTER TABLE messages ADD COLUMN message_type text DEFAULT 'user';
ALTER TABLE messages ADD COLUMN image_url text;
ALTER TABLE messages ADD COLUMN audio_url text;
ALTER TABLE messages ADD COLUMN duration_seconds integer;
ALTER TABLE messages ADD COLUMN reply_to_message_id uuid;
ALTER TABLE messages ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE messages ADD COLUMN mention_data jsonb;
CREATE VIEW profiles_public AS SELECT id,first_name_display,profile_photo_url FROM profiles;
CREATE TABLE chat_reads(circle_id uuid,user_id uuid,last_read_at timestamptz);
CREATE TABLE events(id uuid, circle_id uuid, title text, start_time timestamptz, end_time timestamptz, image_url text, status text);
CREATE TABLE event_members(event_id uuid,user_id uuid,status text);
CREATE TABLE plan_albums(id uuid,event_id uuid);
CREATE TABLE album_uploads(id uuid,display_url text,media_url text,content_type text,created_at timestamptz,user_id uuid,plan_album_id uuid,deleted_at timestamptz);
CREATE TABLE album_visibility(upload_id uuid,visible_to_user_id uuid,hidden_by_viewer boolean);
-- Stub only the unrelated mention parser. These contracts test RPC access/CAS,
-- not production mention-document validation.
CREATE FUNCTION public.validate_chat_mention_document(text,jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce($2,'{"references":[]}'::jsonb); $$;
INSERT INTO events VALUES ('20000000-0000-0000-0000-000000000001',null,'Fixture event',now(),now()+interval '1 hour',null,'active');
INSERT INTO event_members SELECT '20000000-0000-0000-0000-000000000001',id,'joined' FROM profiles;
