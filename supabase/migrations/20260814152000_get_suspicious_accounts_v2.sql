-- Applied directly in production 2026-08-14, replacing the 2026-04-06 draft
-- (20260406500000_bot_detection_view.sql), which had been live from
-- 2026-04-06 to sometime before tonight, then silently vanished (migration
-- ledger drift, same pattern as several other files this session), leaving
-- Bot Watch showing a false "all clear" instead of erroring, because both
-- admin UIs collapse a fetch failure to an empty list with no r.ok check.
--
-- This version fixes 4 real bugs found in the old logic (full detail in
-- handoffs/crucible-T4980-washedup-*-20260814-1547.md): it never consulted
-- bot_watch_cleared so the "Not a Bot" button's writes were dead; the
-- never-returned signal fired on genuinely active users because
-- last_sign_in_at freezes on mobile token refresh (now also requires
-- last_active_at to agree, plus a 2-day minimum account age); plans_joined
-- counted left/removed memberships, not just active ones; no-phone now keys
-- on phone_verified, not merely a non-null string. Live-verified count went
-- from 26 (old logic) to 12 (this version) against the same real data.
--
-- SECURITY: the REVOKE below is load-bearing. The old file granted EXECUTE
-- to service_role but never revoked the Supabase default PUBLIC grant new
-- functions get automatically, which would have made this SECURITY DEFINER
-- function (returns email, phone, behavior data) callable by the anon key.
-- Same bug class caught separately tonight on a drafted admin_delete_user_by_id
-- migration, which was NOT applied for exactly this reason (see task #66).

CREATE OR REPLACE FUNCTION public.get_suspicious_accounts()
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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH joins AS (
    SELECT
      g.user_id,
      count(*) FILTER (WHERE g.status = 'joined') AS plans_joined,
      min(g.gap_seconds) AS min_gap_seconds
    FROM (
      SELECT
        em.user_id,
        em.status,
        EXTRACT(EPOCH FROM (
          em.joined_at - lag(em.joined_at) OVER (PARTITION BY em.user_id ORDER BY em.joined_at)
        )) AS gap_seconds
      FROM event_members em
      WHERE em.user_id IS NOT NULL
    ) g
    GROUP BY g.user_id
  ),
  msgs AS (
    SELECT m.user_id, count(*) AS messages_sent
    FROM messages m
    WHERE m.message_type = 'user' AND m.user_id IS NOT NULL
    GROUP BY m.user_id
  ),
  scored AS (
    SELECT
      p.id, p.first_name_display, p.handle, p.email, p.created_at, p.last_active_at,
      p.bio, p.phone_number, p.profile_photo_url, au.last_sign_in_at,
      coalesce(j.plans_joined, 0) AS plans_joined,
      coalesce(m.messages_sent, 0) AS messages_sent,
      CASE WHEN p.created_at < now() - INTERVAL '2 days'
                AND au.last_sign_in_at IS NOT NULL
                AND (au.last_sign_in_at - au.created_at) < INTERVAL '5 minutes'
                AND (p.last_active_at IS NULL OR p.last_active_at <= p.created_at + INTERVAL '1 day')
           THEN 3 ELSE 0 END AS score_never_returned,
      CASE WHEN p.phone_number IS NULL OR p.phone_verified IS NOT TRUE
           THEN 1 ELSE 0 END AS score_no_phone,
      CASE WHEN nullif(p.bio, '') IS NULL
           THEN 1 ELSE 0 END AS score_no_bio,
      CASE WHEN j.min_gap_seconds IS NOT NULL AND j.min_gap_seconds < 1800
           THEN 3 ELSE 0 END AS score_rapid_join,
      CASE WHEN coalesce(m.messages_sent, 0) >= 8 OR coalesce(j.plans_joined, 0) >= 5
           THEN -5 ELSE 0 END AS score_active_engagement
    FROM profiles p
    JOIN auth.users au ON au.id = p.id
    LEFT JOIN joins j ON j.user_id = p.id
    LEFT JOIN msgs m ON m.user_id = p.id
    WHERE (au.banned_until IS NULL OR au.banned_until < now())
      AND (p.suspended_until IS NULL OR p.suspended_until < now())
      AND NOT EXISTS (SELECT 1 FROM bot_watch_cleared bwc WHERE bwc.user_id = p.id)
  )
  SELECT
    s.id, s.first_name_display, s.handle, s.email, s.created_at, s.last_active_at,
    s.bio, s.phone_number, s.profile_photo_url, s.last_sign_in_at,
    s.plans_joined, s.messages_sent, s.score_never_returned, s.score_no_phone,
    s.score_no_bio, s.score_rapid_join, s.score_active_engagement,
    (s.score_never_returned + s.score_no_phone + s.score_no_bio
      + s.score_rapid_join + s.score_active_engagement) AS suspicion_score
  FROM scored s
  WHERE (s.score_never_returned + s.score_no_phone + s.score_no_bio
      + s.score_rapid_join + s.score_active_engagement) >= 6
  ORDER BY
    (s.score_never_returned + s.score_no_phone + s.score_no_bio
      + s.score_rapid_join + s.score_active_engagement) DESC,
    s.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.get_suspicious_accounts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_suspicious_accounts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_suspicious_accounts() TO service_role;
