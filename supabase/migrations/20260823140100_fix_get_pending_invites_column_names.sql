-- fix: get_pending_invites() referenced pi.inviter_id / pi.invitee_id --
-- plan_invites has never had those columns, its real columns are sender_id
-- and recipient_id. Confirmed broken live via `supabase db lint --linked`
-- 2026-08-23: "column pi.inviter_id does not exist". Every real call to this
-- function has always errored. Output column name `inviter_id` is kept
-- as-is (aliased from sender_id) so callers reading the return shape are
-- unaffected.

CREATE OR REPLACE FUNCTION public.get_pending_invites(p_user_id uuid)
 RETURNS TABLE(invite_id uuid, event_id uuid, inviter_id uuid, inviter_name text, inviter_photo text, plan_title text, plan_start_time timestamp with time zone, plan_location text, plan_image_url text, plan_member_count integer, plan_max_invites integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    pi.id AS invite_id,
    pi.event_id,
    pi.sender_id AS inviter_id,
    p.first_name_display AS inviter_name,
    p.profile_photo_url AS inviter_photo,
    e.title AS plan_title,
    e.start_time AS plan_start_time,
    e.location_text AS plan_location,
    e.image_url AS plan_image_url,
    e.member_count::integer AS plan_member_count,
    e.max_invites::integer AS plan_max_invites,
    pi.created_at
  FROM plan_invites pi
  JOIN events e ON e.id = pi.event_id
  JOIN profiles p ON p.id = pi.sender_id
  JOIN friends f ON f.user_id = p_user_id AND f.friend_id = pi.sender_id
  WHERE pi.recipient_id = p_user_id
    AND pi.status = 'pending'
    AND e.status IN ('forming', 'active', 'full')
    AND e.start_time > NOW()
  ORDER BY pi.created_at DESC;
END;
$function$;
