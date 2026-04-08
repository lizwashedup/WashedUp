-- Documentation-only. Applied directly in production Supabase on 2026-04-06.
-- Removes handle from profiles_public view to prevent exposure to other users.
-- Creates an RPC for handle-based search that returns matches only (never exposes handles in bulk).

-- 1. Recreate profiles_public WITHOUT handle
DROP VIEW IF EXISTS profiles_public;
CREATE VIEW profiles_public AS
SELECT
  id, first_name_display, profile_photo_url, bio, vibe_tags,
  city, gender, instagram_handle, linkedin_url, tiktok_handle,
  EXTRACT(YEAR FROM age(birthday))::text AS age_group
FROM profiles;
GRANT SELECT ON profiles_public TO anon, authenticated, service_role;

-- 2. RPC for handle-based search (returns name + photo, never the handle itself)
CREATE OR REPLACE FUNCTION search_users_by_handle(p_query text, p_user_id uuid)
RETURNS TABLE(id uuid, first_name_display text, profile_photo_url text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.first_name_display, p.profile_photo_url
  FROM profiles p
  WHERE p.handle ILIKE '%' || p_query || '%'
    AND p.id != p_user_id
    AND p.onboarding_status = 'complete'
    AND NOT (p_user_id = ANY(COALESCE(p.blocked_users, ARRAY[]::UUID[])))
  LIMIT 20;
END;
$$;
