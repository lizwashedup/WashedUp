-- Preserve existing dispatch decisions while carrying the exact reaction source.
-- The original RPC and notification rows remain compatible with older workers.
BEGIN;
CREATE FUNCTION public.get_member_chat_push_targets_v2(p_notification_ids uuid[])
RETURNS TABLE(notification_id uuid, user_id uuid, event_id uuid, circle_id uuid, eligible boolean, reaction_message_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY
 SELECT t.notification_id,t.user_id,t.event_id,t.circle_id,t.eligible,
  CASE WHEN t.eligible THEN s.message_id ELSE NULL END
 FROM public.get_member_chat_push_targets(p_notification_ids) t
 LEFT JOIN public.member_reaction_notification_sources s ON s.notification_id=t.notification_id;
END $$;
REVOKE ALL ON FUNCTION public.get_member_chat_push_targets_v2(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_chat_push_targets_v2(uuid[]) TO service_role;
COMMIT;
