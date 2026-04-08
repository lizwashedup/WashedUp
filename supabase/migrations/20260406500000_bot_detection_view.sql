-- Bot detection: index for rapid-join self-join performance
CREATE INDEX IF NOT EXISTS idx_event_members_user_joined
  ON event_members (user_id, joined_at);

-- SECURITY DEFINER function so auth.users is accessible without grants
CREATE OR REPLACE FUNCTION get_suspicious_accounts()
RETURNS TABLE (
  id uuid,
  first_name_display text,
  handle text,
  email text,
  created_at timestamptz,
  last_active_at timestamptz,
  bio text,
  phone_number text,
  profile_photo_url text,
  last_sign_in_at timestamptz,
  plans_joined bigint,
  messages_sent bigint,
  score_never_returned int,
  score_no_phone int,
  score_no_bio int,
  score_rapid_join int,
  score_active_engagement int,
  suspicion_score int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scored AS (
    SELECT
      p.id,
      p.first_name_display,
      p.handle,
      p.email,
      p.created_at,
      p.last_active_at,
      p.bio,
      p.phone_number,
      p.profile_photo_url,
      au.last_sign_in_at,
      (SELECT COUNT(*) FROM event_members em WHERE em.user_id = p.id) AS plans_joined,
      (SELECT COUNT(*) FROM messages m WHERE m.user_id = p.id AND m.message_type = 'user') AS messages_sent,
      CASE WHEN (au.last_sign_in_at - au.created_at) < INTERVAL '5 minutes' THEN 3 ELSE 0 END AS score_never_returned,
      CASE WHEN p.phone_number IS NULL THEN 1 ELSE 0 END AS score_no_phone,
      CASE WHEN p.bio IS NULL THEN 1 ELSE 0 END AS score_no_bio,
      CASE WHEN EXISTS (
        SELECT 1 FROM event_members em1
        JOIN event_members em2 ON em2.user_id = em1.user_id AND em2.id != em1.id
        WHERE em1.user_id = p.id
          AND ABS(EXTRACT(EPOCH FROM (em2.joined_at - em1.joined_at))) < 1800
      ) THEN 3 ELSE 0 END AS score_rapid_join,
      CASE WHEN (SELECT COUNT(*) FROM messages m WHERE m.user_id = p.id AND m.message_type = 'user') >= 8
                OR (SELECT COUNT(*) FROM event_members em WHERE em.user_id = p.id) >= 5
           THEN -5 ELSE 0 END AS score_active_engagement
    FROM profiles p
    JOIN auth.users au ON au.id = p.id
    WHERE au.banned_until IS NULL OR au.banned_until < NOW()
  )
  SELECT
    s.*,
    (s.score_never_returned + s.score_no_phone + s.score_no_bio + s.score_rapid_join + s.score_active_engagement) AS suspicion_score
  FROM scored s
  WHERE (s.score_never_returned + s.score_no_phone + s.score_no_bio + s.score_rapid_join + s.score_active_engagement) >= 6
  ORDER BY (s.score_never_returned + s.score_no_phone + s.score_no_bio + s.score_rapid_join + s.score_active_engagement) DESC, s.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_suspicious_accounts() TO service_role;
