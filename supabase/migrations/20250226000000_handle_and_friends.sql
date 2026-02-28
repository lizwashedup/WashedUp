-- Your People: handle column + friends table
-- Run in Supabase SQL Editor (Lovable) if migrations aren't applied automatically

-- 1. Add handle column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS handle text UNIQUE;

-- Index for fast search by handle
CREATE INDEX IF NOT EXISTS profiles_handle_idx ON profiles (lower(handle));
CREATE INDEX IF NOT EXISTS profiles_handle_like_idx ON profiles (handle text_pattern_ops);

-- Validation: 2-20 chars, lowercase alphanumeric + underscores, no reserved words
CREATE OR REPLACE FUNCTION validate_handle()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.handle IS NULL OR NEW.handle = '' THEN
    RETURN NEW;
  END IF;
  IF length(NEW.handle) < 2 OR length(NEW.handle) > 20 THEN
    RAISE EXCEPTION 'Handle must be 2-20 characters';
  END IF;
  IF NEW.handle !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Handle must be lowercase letters, numbers, and underscores only';
  END IF;
  IF lower(NEW.handle) IN ('admin','support','help','washedup','api','www','app','null','undefined') THEN
    RAISE EXCEPTION 'Handle is reserved';
  END IF;
  NEW.handle := lower(trim(NEW.handle));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_handle_trigger ON profiles;
CREATE TRIGGER validate_handle_trigger
  BEFORE INSERT OR UPDATE OF handle ON profiles
  FOR EACH ROW EXECUTE FUNCTION validate_handle();

-- 2. Friends table (symmetric connections)
CREATE TABLE IF NOT EXISTS friends (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT friends_user_friend_unique UNIQUE (user_id, friend_id),
  CONSTRAINT friends_no_self CHECK (user_id != friend_id)
);

CREATE INDEX IF NOT EXISTS friends_user_id_idx ON friends (user_id);
CREATE INDEX IF NOT EXISTS friends_friend_id_idx ON friends (friend_id);

ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friends_select_own" ON friends;
CREATE POLICY "friends_select_own" ON friends FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends_insert_own" ON friends;
CREATE POLICY "friends_insert_own" ON friends FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends_delete_own" ON friends;
CREATE POLICY "friends_delete_own" ON friends FOR DELETE USING (auth.uid() = user_id);

-- RPC: add friend (symmetric — inserts both rows; RLS blocks direct insert of other user's row)
CREATE OR REPLACE FUNCTION add_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_user_id uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_friend_id = p_user_id THEN
    RAISE EXCEPTION 'Cannot add yourself';
  END IF;
  INSERT INTO friends (user_id, friend_id) VALUES (p_user_id, p_friend_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;
  INSERT INTO friends (user_id, friend_id) VALUES (p_friend_id, p_user_id)
  ON CONFLICT (user_id, friend_id) DO NOTHING;
END;
$$;

-- RPC: remove friend (deletes both rows)
CREATE OR REPLACE FUNCTION remove_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_user_id uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM friends WHERE user_id = p_user_id AND friend_id = p_friend_id;
  DELETE FROM friends WHERE user_id = p_friend_id AND friend_id = p_user_id;
END;
$$;

-- 3. Add handle to profiles_public view (recreate view)
-- First drop if exists (view may have different columns)
DROP VIEW IF EXISTS profiles_public;
CREATE VIEW profiles_public AS
SELECT id, first_name_display, profile_photo_url, bio, vibe_tags, city, gender,
       instagram_handle, linkedin_url, tiktok_handle, handle
FROM profiles;
