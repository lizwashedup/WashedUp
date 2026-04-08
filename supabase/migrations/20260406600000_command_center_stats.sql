-- Command Center: single RPC returning all dashboard metrics as jsonb
-- Replaces the old pattern of fetching all rows into Node.js memory

CREATE OR REPLACE FUNCTION get_command_center_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  pt_today date;
  pt_7d_ago date;
  pt_28d_ago date;
  pt_56d_ago date;
BEGIN
  -- PT-anchored date boundaries
  pt_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  pt_7d_ago := pt_today - 7;
  pt_28d_ago := pt_today - 28;
  pt_56d_ago := pt_today - 56;

  WITH
  -- Base user counts
  all_profiles AS (
    SELECT
      count(*) AS total_users,
      count(*) FILTER (WHERE onboarding_status = 'complete') AS activated_users,
      count(*) FILTER (WHERE created_at >= pt_today::timestamptz AT TIME ZONE 'America/Los_Angeles') AS new_today,
      count(*) FILTER (WHERE created_at >= pt_7d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles') AS new_7d,
      count(*) FILTER (WHERE created_at >= pt_28d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles') AS new_28d,
      count(*) FILTER (WHERE created_at >= pt_56d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles'
                          AND created_at < pt_28d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles') AS prev_28d,
      -- Trust: gender breakdown of activated users
      count(*) FILTER (WHERE onboarding_status = 'complete' AND gender = 'woman') AS women_count,
      count(*) FILTER (WHERE onboarding_status = 'complete' AND gender = 'man') AS men_count,
      count(*) FILTER (WHERE onboarding_status = 'complete' AND gender = 'non_binary') AS nonbinary_count,
      -- Onboarding funnel
      count(*) FILTER (WHERE onboarding_status != 'complete'
                          AND (first_name_display IS NULL AND gender IS NULL AND profile_photo_url IS NULL)) AS stuck_never_started,
      count(*) FILTER (WHERE onboarding_status != 'complete'
                          AND first_name_display IS NOT NULL AND profile_photo_url IS NULL) AS stuck_at_photo,
      count(*) FILTER (WHERE onboarding_status != 'complete'
                          AND profile_photo_url IS NOT NULL) AS stuck_almost_done,
      count(*) FILTER (WHERE profile_photo_url IS NOT NULL) AS has_photo,
      count(*) FILTER (WHERE bio IS NOT NULL AND bio != '') AS has_bio,
      count(*) FILTER (WHERE phone_number IS NOT NULL AND phone_verified = true) AS sms_enabled,
      -- DAU (last_active_at since PT midnight today)
      count(*) FILTER (WHERE onboarding_status = 'complete'
                          AND last_active_at >= pt_today::timestamptz AT TIME ZONE 'America/Los_Angeles') AS dau
    FROM profiles
  ),

  -- Engaged MAU: unique users who messaged, joined, or created a plan in last 28d
  engaged_mau_users AS (
    SELECT DISTINCT user_id FROM messages
      WHERE created_at >= pt_28d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles'
        AND message_type = 'user'
    UNION
    SELECT DISTINCT user_id FROM event_members
      WHERE joined_at >= pt_28d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles'
        AND status = 'joined'
    UNION
    SELECT DISTINCT creator_user_id FROM events
      WHERE created_at >= pt_28d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles'
        AND status != 'draft'
  ),
  engaged_mau AS (
    SELECT count(*) AS engaged_mau
    FROM engaged_mau_users eu
    JOIN profiles p ON p.id = eu.user_id
    WHERE p.onboarding_status = 'complete'
  ),

  -- WAU: same definition but 7 days
  engaged_wau_users AS (
    SELECT DISTINCT user_id FROM messages
      WHERE created_at >= pt_7d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles'
        AND message_type = 'user'
    UNION
    SELECT DISTINCT user_id FROM event_members
      WHERE joined_at >= pt_7d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles'
        AND status = 'joined'
    UNION
    SELECT DISTINCT creator_user_id FROM events
      WHERE created_at >= pt_7d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles'
        AND status != 'draft'
  ),
  engaged_wau AS (
    SELECT count(*) AS wau
    FROM engaged_wau_users wu
    JOIN profiles p ON p.id = wu.user_id
    WHERE p.onboarding_status = 'complete'
  ),

  -- Event/plan metrics
  event_stats AS (
    SELECT
      count(*) AS total_plans,
      count(*) FILTER (WHERE status != 'draft') AS published_plans,
      count(*) FILTER (WHERE status = 'completed') AS plans_completed,
      count(*) FILTER (WHERE status = 'completed'
                          AND created_at >= pt_7d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles') AS plans_completed_7d,
      count(*) FILTER (WHERE status IN ('forming', 'active', 'full')) AS plans_active,
      count(*) FILTER (WHERE status != 'draft'
                          AND created_at >= pt_7d_ago::timestamptz AT TIME ZONE 'America/Los_Angeles') AS plans_created_7d,
      count(*) FILTER (WHERE status != 'draft' AND member_count >= 3) AS plans_3plus,
      count(*) FILTER (WHERE status = 'cancelled') AS plans_cancelled
    FROM events
  ),

  -- Creator and joiner counts
  creator_stats AS (
    SELECT
      count(DISTINCT creator_user_id) AS total_creators,
      count(DISTINCT creator_user_id) FILTER (WHERE ct >= 2) AS repeat_hosts
    FROM (
      SELECT creator_user_id, count(*) AS ct
      FROM events WHERE status != 'draft'
      GROUP BY creator_user_id
    ) sub
  ),

  joiner_stats AS (
    SELECT
      count(DISTINCT user_id) AS total_joiners,
      count(DISTINCT user_id) FILTER (WHERE plan_count >= 2) AS repeat_joiners
    FROM (
      SELECT user_id, count(DISTINCT event_id) AS plan_count
      FROM event_members WHERE status = 'joined'
      GROUP BY user_id
    ) sub
  ),

  -- Retention: D7 and D30
  retention AS (
    SELECT
      count(*) FILTER (WHERE created_at <= (now() - interval '7 days')
                          AND onboarding_status = 'complete') AS d7_eligible,
      count(*) FILTER (WHERE created_at <= (now() - interval '7 days')
                          AND onboarding_status = 'complete'
                          AND first_return_at IS NOT NULL
                          AND first_return_at <= created_at + interval '7 days') AS d7_retained,
      count(*) FILTER (WHERE created_at <= (now() - interval '30 days')
                          AND onboarding_status = 'complete') AS d30_eligible,
      count(*) FILTER (WHERE created_at <= (now() - interval '30 days')
                          AND onboarding_status = 'complete'
                          AND first_return_at IS NOT NULL
                          AND first_return_at <= created_at + interval '30 days') AS d30_retained
    FROM profiles
  ),

  -- Generational Bridge Index: age span in completed plans
  plan_age_spans AS (
    SELECT
      em.event_id,
      max(extract(year FROM age(now(), p.birthday))) - min(extract(year FROM age(now(), p.birthday))) AS age_span
    FROM event_members em
    JOIN profiles p ON p.id = em.user_id
    JOIN events e ON e.id = em.event_id
    WHERE em.status = 'joined'
      AND e.status = 'completed'
      AND p.birthday IS NOT NULL
    GROUP BY em.event_id
    HAVING count(DISTINCT em.user_id) >= 2
      AND count(DISTINCT p.birthday) >= 2
  ),
  gen_bridge AS (
    SELECT
      coalesce(round(avg(age_span), 1), 0) AS avg_age_span,
      CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE age_span >= 20) / count(*), 1)
        ELSE 0 END AS pct_plans_20yr_span
    FROM plan_age_spans
  ),

  -- Stranger-Friend Pairs: user pairs who attended 2+ different plans together
  -- (neither user created ALL their shared plans)
  friend_pairs AS (
    SELECT count(*) AS stranger_friend_pairs
    FROM (
      SELECT em1.user_id AS u1, em2.user_id AS u2,
        count(DISTINCT em1.event_id) AS shared,
        count(DISTINCT em1.event_id) FILTER (
          WHERE em1.event_id IN (SELECT id FROM events WHERE creator_user_id = em1.user_id)
        ) AS u1_created,
        count(DISTINCT em1.event_id) FILTER (
          WHERE em1.event_id IN (SELECT id FROM events WHERE creator_user_id = em2.user_id)
        ) AS u2_created
      FROM event_members em1
      JOIN event_members em2 ON em1.event_id = em2.event_id
        AND em1.user_id < em2.user_id
      WHERE em1.status = 'joined' AND em2.status = 'joined'
      GROUP BY em1.user_id, em2.user_id
      HAVING count(DISTINCT em1.event_id) >= 2
    ) pairs
    WHERE u1_created < shared AND u2_created < shared
  ),

  -- Joiner-to-Creator Flywheel
  joiner_creator AS (
    SELECT
      count(*) FILTER (WHERE first_create_at IS NOT NULL AND first_create_at > first_join_at) AS joiner_to_creator_count,
      count(*) AS joiner_to_creator_denom
    FROM (
      SELECT
        fj.user_id,
        fj.first_join_at,
        min(e.created_at) AS first_create_at
      FROM (
        SELECT user_id, min(joined_at) AS first_join_at
        FROM event_members
        WHERE role = 'guest' AND status = 'joined' AND joined_at IS NOT NULL
        GROUP BY user_id
      ) fj
      LEFT JOIN events e ON e.creator_user_id = fj.user_id AND e.status != 'draft'
      GROUP BY fj.user_id, fj.first_join_at
    ) sub
  ),

  -- Repeat Attendance Distribution
  repeat_dist AS (
    SELECT
      count(*) FILTER (WHERE plan_count = 1) AS users_1_plan,
      count(*) FILTER (WHERE plan_count = 2) AS users_2,
      count(*) FILTER (WHERE plan_count = 3) AS users_3,
      count(*) FILTER (WHERE plan_count = 4) AS users_4,
      count(*) FILTER (WHERE plan_count >= 5) AS users_5plus
    FROM (
      SELECT user_id, count(DISTINCT event_id) AS plan_count
      FROM event_members WHERE status = 'joined'
      GROUP BY user_id
    ) sub
  ),

  -- Chat engagement
  chat_stats AS (
    SELECT
      count(*) AS total_messages,
      count(DISTINCT event_id) AS chat_plans_count,
      count(DISTINCT user_id) AS users_who_chatted
    FROM messages WHERE message_type = 'user'
  ),

  -- Signups by day (last 7 days)
  signups_daily AS (
    SELECT json_agg(row_to_json(d) ORDER BY d.dt) AS signups_by_day
    FROM (
      SELECT
        d.dt::text AS date,
        coalesce(count(p.id), 0) AS count
      FROM generate_series(pt_7d_ago, pt_today - 1, '1 day'::interval) d(dt)
      LEFT JOIN profiles p ON (p.created_at AT TIME ZONE 'America/Los_Angeles')::date = d.dt::date
      GROUP BY d.dt
    ) d
  ),

  -- Signups by source
  signups_source AS (
    SELECT json_agg(row_to_json(s) ORDER BY s.count DESC) AS signups_by_source
    FROM (
      SELECT coalesce(referral_source, 'Unknown') AS source, count(*) AS count
      FROM profiles
      WHERE referral_source IS NOT NULL AND referral_source != ''
      GROUP BY referral_source
      ORDER BY count DESC
    ) s
  ),

  -- Weekly snapshots for ops page
  weekly AS (
    SELECT json_agg(row_to_json(w) ORDER BY w.week_number) AS weekly_data
    FROM (
      SELECT week_number, week_start, week_end, total_users, new_users,
        seven_day_retention_rate, returned_ever_rate,
        total_plans, plans_two_plus, plans_three_plus,
        avg_members_per_plan, active_plans, total_messages
      FROM weekly_snapshots
      ORDER BY week_number
    ) w
  )

  SELECT jsonb_build_object(
    -- Growth
    'total_users', ap.total_users,
    'activated_users', ap.activated_users,
    'new_today', ap.new_today,
    'new_7d', ap.new_7d,
    'new_28d', ap.new_28d,
    'prev_28d', ap.prev_28d,
    'mom_growth_pct', CASE WHEN ap.prev_28d > 0
      THEN round(100.0 * (ap.new_28d - ap.prev_28d) / ap.prev_28d, 1)
      ELSE 0 END,

    -- Trust
    'women_count', ap.women_count,
    'men_count', ap.men_count,
    'nonbinary_count', ap.nonbinary_count,

    -- Engagement
    'engaged_mau', em.engaged_mau,
    'wau', ew.wau,
    'dau', ap.dau,
    'wau_mau_ratio', CASE WHEN em.engaged_mau > 0
      THEN round(100.0 * ew.wau / em.engaged_mau, 1) ELSE 0 END,
    'dau_mau_ratio', CASE WHEN em.engaged_mau > 0
      THEN round(100.0 * ap.dau / em.engaged_mau, 1) ELSE 0 END,

    -- Plans
    'plans_completed', es.plans_completed,
    'plans_completed_7d', es.plans_completed_7d,
    'plans_active', es.plans_active,
    'plans_created_7d', es.plans_created_7d,
    'published_plans', es.published_plans,
    'total_plans', es.total_plans,
    'plans_cancelled', es.plans_cancelled,
    'fill_rate_3plus', CASE WHEN es.published_plans > 0
      THEN round(100.0 * es.plans_3plus / es.published_plans, 1) ELSE 0 END,

    -- Creators / Joiners
    'total_creators', cs.total_creators,
    'repeat_hosts', cs.repeat_hosts,
    'creator_retention_rate', CASE WHEN cs.total_creators > 0
      THEN round(100.0 * cs.repeat_hosts / cs.total_creators, 1) ELSE 0 END,
    'total_joiners', js.total_joiners,
    'repeat_joiners', js.repeat_joiners,
    'physical_participation_rate', CASE WHEN ap.activated_users > 0
      THEN round(100.0 * js.total_joiners / ap.activated_users, 1) ELSE 0 END,
    'organic_creator_rate', CASE WHEN ap.activated_users > 0
      THEN round(100.0 * cs.total_creators / ap.activated_users, 1) ELSE 0 END,

    -- Retention
    'd7_retained', r.d7_retained,
    'd7_eligible', r.d7_eligible,
    'd30_retained', r.d30_retained,
    'd30_eligible', r.d30_eligible,

    -- WashedUp-Only
    'avg_age_span', gb.avg_age_span,
    'pct_plans_20yr_span', gb.pct_plans_20yr_span,
    'stranger_friend_pairs', fp.stranger_friend_pairs,
    'joiner_to_creator_count', jc.joiner_to_creator_count,
    'joiner_to_creator_denom', jc.joiner_to_creator_denom,

    -- Repeat distribution
    'users_1_plan', rd.users_1_plan,
    'users_2', rd.users_2,
    'users_3', rd.users_3,
    'users_4', rd.users_4,
    'users_5plus', rd.users_5plus,

    -- Ops: onboarding funnel
    'stuck_never_started', ap.stuck_never_started,
    'stuck_at_photo', ap.stuck_at_photo,
    'stuck_almost_done', ap.stuck_almost_done,
    'has_photo', ap.has_photo,
    'has_bio', ap.has_bio,
    'sms_enabled', ap.sms_enabled,

    -- Ops: chat
    'total_messages', cs2.total_messages,
    'chat_plans_count', cs2.chat_plans_count,
    'users_who_chatted', cs2.users_who_chatted,
    'avg_msgs_per_plan', CASE WHEN cs2.chat_plans_count > 0
      THEN round(1.0 * cs2.total_messages / cs2.chat_plans_count, 1) ELSE 0 END,

    -- Arrays
    'signups_by_day', coalesce(sd.signups_by_day::jsonb, '[]'::jsonb),
    'signups_by_source', coalesce(ss.signups_by_source::jsonb, '[]'::jsonb),
    'weekly_data', coalesce(wd.weekly_data::jsonb, '[]'::jsonb)
  ) INTO result
  FROM all_profiles ap
  CROSS JOIN engaged_mau em
  CROSS JOIN engaged_wau ew
  CROSS JOIN event_stats es
  CROSS JOIN creator_stats cs
  CROSS JOIN joiner_stats js
  CROSS JOIN retention r
  CROSS JOIN gen_bridge gb
  CROSS JOIN friend_pairs fp
  CROSS JOIN joiner_creator jc
  CROSS JOIN repeat_dist rd
  CROSS JOIN chat_stats cs2
  CROSS JOIN signups_daily sd
  CROSS JOIN signups_source ss
  CROSS JOIN weekly wd;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_command_center_stats() TO service_role;
