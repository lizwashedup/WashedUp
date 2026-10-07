-- REVIEW ONLY. The measured page-update gap missed the current user_blocks store.
-- Reuse the existing canonical two-store, two-direction helper in these three
-- page-specific boundaries. Do not change legacy broadcasting or global helpers.
BEGIN;
DO $guard$ BEGIN
 IF md5(pg_get_functiondef('public.creator_page_broadcast_can_read(uuid)'::regprocedure))<>'451efdc1cdf82eddf5f271352a02f3a9' THEN RAISE EXCEPTION 'Unexpected creator_page_broadcast_can_read definition'; END IF;
 IF md5(pg_get_functiondef('public.send_creator_page_broadcast(uuid,uuid,text)'::regprocedure))<>'f387e46f316afd37bfa2803dc826a49d' THEN RAISE EXCEPTION 'Unexpected send_creator_page_broadcast definition'; END IF;
 IF md5(pg_get_functiondef('public.get_creator_page_push_targets(uuid[])'::regprocedure))<>'18d6a776872ad8d95fe8866ca1797936' THEN RAISE EXCEPTION 'Unexpected get_creator_page_push_targets definition'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.creator_page_broadcast_can_read(p_broadcast_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.follower_broadcasts b
 JOIN public.creator_page_follow_states f ON f.page_id=b.creator_page_id AND f.user_id=auth.uid() AND f.following
 WHERE b.id=p_broadcast_id AND b.visible_at<=now() AND public.creator_page_is_visible(b.creator_page_id)
 AND NOT public.yours_is_blocked_between(b.sender_user_id,auth.uid()));
$function$
;
CREATE OR REPLACE FUNCTION public.send_creator_page_broadcast(p_page_id uuid, p_attempt_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); v_body text:=btrim(p_body); v_page public.creator_page_publications;
 v_row public.follower_broadcasts; v_inserted integer; v_count integer;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT401',MESSAGE='Sign in to send an update.'; END IF;
 IF p_page_id IS NULL OR p_attempt_id IS NULL OR v_body IS NULL OR char_length(v_body)=0 OR char_length(v_body)>2000 THEN
  RAISE EXCEPTION USING ERRCODE='PT422',MESSAGE='An update must contain 1 to 2000 characters.';
 END IF;
 SELECT * INTO v_row FROM public.follower_broadcasts WHERE id=p_attempt_id FOR UPDATE;
 IF FOUND THEN
  IF v_row.sender_user_id<>v_uid OR v_row.creator_page_id IS DISTINCT FROM p_page_id OR v_row.body<>v_body THEN
   RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='This saved attempt belongs to a different update.';
  END IF;
  RETURN public.creator_page_broadcast_receipt(v_row);
 END IF;
 SELECT * INTO v_page FROM public.creator_page_publications WHERE page_id=p_page_id FOR SHARE;
 IF NOT FOUND OR v_page.page_kind<>'organization' OR v_page.owner_id IS DISTINCT FROM v_uid OR NOT public.creator_page_is_visible(p_page_id) THEN
  RAISE EXCEPTION USING ERRCODE='PT403',MESSAGE='Only this published organization’s owner can send an update.';
 END IF;
 INSERT INTO public.follower_broadcasts(id,sender_user_id,creator_page_id,body,queued_recipient_count)
 VALUES(p_attempt_id,v_uid,p_page_id,v_body,0) ON CONFLICT(id) DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 SELECT * INTO v_row FROM public.follower_broadcasts WHERE id=p_attempt_id FOR UPDATE;
 IF v_row.sender_user_id<>v_uid OR v_row.creator_page_id IS DISTINCT FROM p_page_id OR v_row.body<>v_body THEN
  RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='This saved attempt belongs to a different update.';
 END IF;
 IF v_inserted=0 THEN RETURN public.creator_page_broadcast_receipt(v_row); END IF;
 -- Hold eligible follow rows through queue insertion. A concurrent unfollow then
 -- suppresses these rows; a later refollow never revives an old update.
 WITH audience AS MATERIALIZED (
  SELECT f.user_id FROM public.creator_page_follow_states f
  WHERE f.page_id=p_page_id AND f.following AND f.user_id<>v_uid
   AND NOT public.yours_is_blocked_between(v_uid,f.user_id)
  FOR SHARE OF f
 ), notices AS (
  INSERT INTO public.app_notifications(user_id,type,title,body,actor_user_id,status,push_sent,push_suppressed)
  SELECT user_id,'creator_page_update',v_page.name,v_body,v_uid,'unread',false,false FROM audience
  RETURNING id,user_id
 )
 INSERT INTO public.creator_page_broadcast_notifications(notification_id,broadcast_id,page_id,user_id)
 SELECT id,p_attempt_id,p_page_id,user_id FROM notices;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 UPDATE public.follower_broadcasts SET queued_recipient_count=v_count WHERE id=p_attempt_id RETURNING * INTO v_row;
 RETURN public.creator_page_broadcast_receipt(v_row);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_creator_page_push_targets(p_notification_ids uuid[])
 RETURNS TABLE(notification_id uuid, page_id uuid, broadcast_id uuid, user_id uuid, eligible boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 -- A rejected dispatch decision is terminal for this notification. The row may
 -- already be claimed; later retries/refollows cannot revive it.
 UPDATE public.creator_page_broadcast_notifications m SET suppressed_at=coalesce(m.suppressed_at,now())
 FROM public.app_notifications n
 WHERE n.id=m.notification_id AND m.notification_id=ANY(p_notification_ids) AND (
  n.user_id<>m.user_id OR n.push_suppressed OR n.status<>'unread' OR n.type<>'creator_page_update'
  OR (n.expires_at IS NOT NULL AND n.expires_at<=now())
  OR NOT EXISTS(SELECT 1 FROM public.creator_page_publications p WHERE p.page_id=m.page_id AND p.page_kind='organization')
  OR NOT EXISTS(SELECT 1 FROM public.creator_page_follow_states f WHERE f.page_id=m.page_id AND f.user_id=m.user_id AND f.following)
  OR NOT EXISTS(SELECT 1 FROM public.follower_broadcasts b WHERE b.id=m.broadcast_id)
  OR EXISTS(SELECT 1 FROM public.follower_broadcasts b WHERE b.id=m.broadcast_id AND public.yours_is_blocked_between(b.sender_user_id,m.user_id))
 );
 UPDATE public.app_notifications n SET push_suppressed=true FROM public.creator_page_broadcast_notifications m
 WHERE m.notification_id=n.id AND m.notification_id=ANY(p_notification_ids) AND m.suppressed_at IS NOT NULL;
 RETURN QUERY SELECT m.notification_id,m.page_id,m.broadcast_id,m.user_id,m.suppressed_at IS NULL
 FROM public.creator_page_broadcast_notifications m JOIN public.app_notifications n ON n.id=m.notification_id
 WHERE m.notification_id=ANY(p_notification_ids);
END;
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
