-- Add mini-profile fields to profiles (queried directly, NOT through profiles_public)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS is_traveling boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS fun_fact text;

-- Restore profiles_public to its original structure (DO NOT add new columns here —
-- the get_filtered_feed RPC return type is bound to this view's column set)
DROP VIEW IF EXISTS profiles_public;

CREATE VIEW profiles_public AS
SELECT
  id,
  first_name_display,
  profile_photo_url,
  bio,
  vibe_tags,
  city,
  gender,
  handle,
  instagram_handle,
  linkedin_url,
  tiktok_handle,
  EXTRACT(YEAR FROM age(birthday))::text AS age_group
FROM profiles;

GRANT SELECT ON profiles_public TO anon, authenticated, service_role;
