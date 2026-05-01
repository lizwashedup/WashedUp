-- Capture compute_user_badge_counts from prod into version control.
-- This function exists in prod (deployed manually with edge function v10)
-- but was never committed to migrations. Captured from prod on 2026-05-01
-- via SELECT pg_get_functiondef(...).
--
-- Required by send-push-notifications edge function for per-user badge math.
-- Returns: distinct unread chats + non-message/non-invite inbox notifications
-- + pending plan invites.

CREATE OR REPLACE FUNCTION public.compute_user_badge_counts(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, badge integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH chat_unread AS (
    SELECT n.user_id, COUNT(DISTINCT n.event_id)::int AS c
    FROM app_notifications n
    WHERE n.user_id = ANY(p_user_ids)
      AND n.type = 'new_message'
      AND n.status = 'unread'
    GROUP BY n.user_id
  ),
  inbox_unread AS (
    SELECT n.user_id, COUNT(*)::int AS c
    FROM app_notifications n
    WHERE n.user_id = ANY(p_user_ids)
      AND n.status = 'unread'
      AND n.type NOT IN ('new_message', 'plan_invite')
    GROUP BY n.user_id
  ),
  pending_invites AS (
    SELECT i.recipient_id AS user_id, COUNT(*)::int AS c
    FROM plan_invites i
    WHERE i.recipient_id = ANY(p_user_ids)
      AND i.status = 'pending'
    GROUP BY i.recipient_id
  ),
  all_users AS (
    SELECT unnest(p_user_ids) AS user_id
  )
  SELECT
    u.user_id,
    (COALESCE(c.c, 0) + COALESCE(i.c, 0) + COALESCE(p.c, 0))::int AS badge
  FROM all_users u
  LEFT JOIN chat_unread c ON c.user_id = u.user_id
  LEFT JOIN inbox_unread i ON i.user_id = u.user_id
  LEFT JOIN pending_invites p ON p.user_id = u.user_id;
$function$;
