-- LOCAL / REVIEW ONLY. Add exact page targets to the existing follower broadcast ledger.
-- Do not apply/enable until the worker and native notification consumers carry these targets.
BEGIN;
-- Preserve every existing type while making new page updates distinguishable
-- from legacy broadcasts, including when target metadata is unavailable.
DO $types$ DECLARE old_expression text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT old_expression FROM pg_constraint
 WHERE conrelid='public.app_notifications'::regclass AND conname='app_notifications_type_check';
 ALTER TABLE public.app_notifications DROP CONSTRAINT app_notifications_type_check;
 EXECUTE format('ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_type_check CHECK ((%s) OR type=''creator_page_update'')',old_expression);
END $types$;
ALTER TABLE public.follower_broadcasts
 ADD COLUMN creator_page_id uuid REFERENCES public.creator_page_publications(page_id) ON DELETE CASCADE,
 ADD COLUMN queued_recipient_count integer;
ALTER TABLE public.follower_broadcasts DROP CONSTRAINT follower_broadcasts_exactly_one_target;
ALTER TABLE public.follower_broadcasts ADD CONSTRAINT follower_broadcasts_exactly_one_target CHECK (
 (creator_page_id IS NULL AND queued_recipient_count IS NULL AND
   ((community_id IS NOT NULL AND organizer_user_id IS NULL) OR (community_id IS NULL AND organizer_user_id IS NOT NULL)))
 OR (creator_page_id IS NOT NULL AND community_id IS NULL AND organizer_user_id IS NULL AND queued_recipient_count IS NOT NULL AND queued_recipient_count>=0)
);
ALTER POLICY creator_bound_page_visibility ON public.follower_broadcasts USING (
 (community_id IS NULL OR public.creator_community_is_visible(community_id) OR public.is_admin(auth.uid()))
 AND (creator_page_id IS NULL OR public.creator_page_is_visible(creator_page_id) OR sender_user_id=auth.uid() OR public.is_admin(auth.uid()))
);
CREATE INDEX follower_broadcasts_page ON public.follower_broadcasts(creator_page_id,created_at DESC) WHERE creator_page_id IS NOT NULL;
-- Keep immutable source UUIDs after page/broadcast deletion so delivery can
-- reject tombstoned targets; never turn an orphaned page update into a legacy push.
CREATE TABLE public.creator_page_broadcast_notifications (
 notification_id uuid PRIMARY KEY REFERENCES public.app_notifications(id) ON DELETE CASCADE,
 broadcast_id uuid NOT NULL,
 page_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 suppressed_at timestamptz,
 UNIQUE(broadcast_id,user_id)
);
REVOKE ALL ON public.creator_page_broadcast_notifications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.creator_page_broadcast_notifications TO authenticated;
ALTER TABLE public.creator_page_broadcast_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_page_broadcast_notification_own ON public.creator_page_broadcast_notifications
 FOR SELECT USING(user_id=auth.uid());
CREATE FUNCTION public.creator_page_broadcast_can_read(p_broadcast_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.follower_broadcasts b
 JOIN public.creator_page_follow_states f ON f.page_id=b.creator_page_id AND f.user_id=auth.uid() AND f.following
 WHERE b.id=p_broadcast_id AND b.visible_at<=now() AND public.creator_page_is_visible(b.creator_page_id)
 AND NOT public._users_blocked(b.sender_user_id,auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.creator_page_broadcast_can_read(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.creator_page_broadcast_can_read(uuid) TO authenticated;
CREATE POLICY creator_page_broadcast_follower_read ON public.follower_broadcasts FOR SELECT TO authenticated
 USING(creator_page_id IS NOT NULL AND public.creator_page_broadcast_can_read(id));

CREATE FUNCTION public.creator_page_broadcast_receipt(p_row public.follower_broadcasts) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_row.id,'page_id',p_row.creator_page_id,'sender_user_id',p_row.sender_user_id,
 'body',p_row.body,'created_at',p_row.created_at,'queued_recipient_count',p_row.queued_recipient_count);
$$;
REVOKE ALL ON FUNCTION public.creator_page_broadcast_receipt(public.follower_broadcasts) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.send_creator_page_broadcast(p_page_id uuid,p_attempt_id uuid,p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
   AND NOT public._users_blocked(v_uid,f.user_id)
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
$$;
REVOKE ALL ON FUNCTION public.send_creator_page_broadcast(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.send_creator_page_broadcast(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.suppress_unfollowed_creator_page_updates() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.following AND NOT NEW.following THEN
  UPDATE public.creator_page_broadcast_notifications SET suppressed_at=coalesce(suppressed_at,now())
  WHERE page_id=NEW.page_id AND user_id=NEW.user_id;
  UPDATE public.app_notifications n SET push_suppressed=true
  FROM public.creator_page_broadcast_notifications m
  WHERE m.notification_id=n.id AND m.page_id=NEW.page_id AND m.user_id=NEW.user_id AND n.status='unread';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.suppress_unfollowed_creator_page_updates() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER creator_page_unfollow_suppresses_updates AFTER UPDATE OF following ON public.creator_page_follow_states
 FOR EACH ROW EXECUTE FUNCTION public.suppress_unfollowed_creator_page_updates();

-- Resolve only claimed rows' exact identities immediately before delivery. This
-- service-only result contains no public follower roster and grants no audience.
-- The worker must skip ineligible rows and fail closed if resolution fails.
CREATE FUNCTION public.get_creator_page_push_targets(p_notification_ids uuid[]) RETURNS TABLE(
 notification_id uuid,page_id uuid,broadcast_id uuid,user_id uuid,eligible boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  OR EXISTS(SELECT 1 FROM public.follower_broadcasts b WHERE b.id=m.broadcast_id AND public._users_blocked(b.sender_user_id,m.user_id))
 );
 UPDATE public.app_notifications n SET push_suppressed=true FROM public.creator_page_broadcast_notifications m
 WHERE m.notification_id=n.id AND m.notification_id=ANY(p_notification_ids) AND m.suppressed_at IS NOT NULL;
 RETURN QUERY SELECT m.notification_id,m.page_id,m.broadcast_id,m.user_id,m.suppressed_at IS NULL
 FROM public.creator_page_broadcast_notifications m JOIN public.app_notifications n ON n.id=m.notification_id
 WHERE m.notification_id=ANY(p_notification_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.get_creator_page_push_targets(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_page_push_targets(uuid[]) TO service_role;
COMMIT;
