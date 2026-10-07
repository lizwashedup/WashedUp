-- PRIVATE REVIEW CANDIDATE. Requires the matched workers/native consumers.
-- No activation, backfill, provider calls or permission expansion for invitees.
BEGIN;
ALTER TABLE public.delivery_runtime_config ADD COLUMN page_invitation_alerts_enabled boolean NOT NULL DEFAULT false;
DO $types$ DECLARE old_expression text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT old_expression FROM pg_constraint
 WHERE conrelid='public.app_notifications'::regclass AND conname='app_notifications_type_check';
 ALTER TABLE public.app_notifications DROP CONSTRAINT app_notifications_type_check;
 EXECUTE format('ALTER TABLE public.app_notifications ADD CONSTRAINT app_notifications_type_check CHECK ((%s) OR type=''page_team_invitation'')',old_expression);
END $types$;
CREATE TABLE public.page_team_invitation_notifications (
 notification_id uuid PRIMARY KEY REFERENCES public.app_notifications(id) ON DELETE CASCADE,
 invitation_id uuid NOT NULL UNIQUE,
 page_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
REVOKE ALL ON public.page_team_invitation_notifications FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.page_team_invitation_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.page_team_invitation_notifications TO authenticated;
CREATE POLICY page_team_invitation_notice_own ON public.page_team_invitation_notifications
 FOR SELECT USING (user_id=auth.uid());
ALTER TABLE public.transactional_email_jobs
 DROP CONSTRAINT transactional_email_jobs_kind_check,
 DROP CONSTRAINT transactional_email_jobs_sale_shape,
 ALTER COLUMN explore_event_id DROP NOT NULL,
 ADD COLUMN page_invitation_id uuid,
 ADD CONSTRAINT transactional_email_jobs_kind_check CHECK(kind IN ('free_event_rsvp','creator_ticket_sale','page_team_invitation')),
 ADD CONSTRAINT transactional_email_jobs_sale_shape CHECK(
  (kind='free_event_rsvp' AND explore_event_id IS NOT NULL AND sale_order_id IS NULL AND sale_preference_revision IS NULL AND page_invitation_id IS NULL)
  OR (kind='creator_ticket_sale' AND explore_event_id IS NOT NULL AND sale_order_id IS NOT NULL AND sale_preference_revision IS NOT NULL AND page_invitation_id IS NULL)
  OR (kind='page_team_invitation' AND explore_event_id IS NULL AND sale_order_id IS NULL AND sale_preference_revision IS NULL AND page_invitation_id IS NOT NULL)
 );
CREATE FUNCTION public.enqueue_page_team_invitation_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE mode text; notice uuid;
BEGIN
 SELECT activation_mode INTO mode FROM public.delivery_runtime_config WHERE singleton AND page_invitation_alerts_enabled;
 IF mode IS NULL OR mode='quarantined' THEN RETURN NEW; END IF;
 IF mode<>'live' AND NOT EXISTS(SELECT FROM public.delivery_seed_profiles WHERE profile_id=NEW.recipient_id) THEN RETURN NEW; END IF;
 IF NEW.status<>'pending' OR NEW.expires_at<=now() OR NOT public.creator_page_team_eligible(NEW.page_id,NEW.inviter_id,NEW.recipient_id) THEN RETURN NEW; END IF;
 -- Generic external copy: no private page name, message, permissions or inviter identity.
 INSERT INTO public.app_notifications(user_id,type,title,body,actor_user_id,status,expires_at,push_sent,push_suppressed)
 VALUES(NEW.recipient_id,'page_team_invitation','You have a page invitation','Someone invited you to help with their page. Open WashedUp to review it.',NEW.inviter_id,'unread',NEW.expires_at,false,false)
 RETURNING id INTO notice;
 INSERT INTO public.page_team_invitation_notifications VALUES(notice,NEW.id,NEW.page_id,NEW.recipient_id);
 INSERT INTO public.transactional_email_jobs(kind,idempotency_key,user_id,page_invitation_id,available_at)
 VALUES('page_team_invitation','page-invitation/'||NEW.id::text||'/'||NEW.recipient_id::text,NEW.recipient_id,NEW.id,now())
 ON CONFLICT(idempotency_key) DO NOTHING;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.enqueue_page_team_invitation_alert() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER page_team_invitation_alert_created AFTER INSERT ON public.creator_page_team_invitations
 FOR EACH ROW EXECUTE FUNCTION public.enqueue_page_team_invitation_alert();
CREATE FUNCTION public.retire_page_team_invitation_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status<>'pending' THEN
  UPDATE public.app_notifications n SET status='expired',push_suppressed=true
  FROM public.page_team_invitation_notifications m WHERE m.invitation_id=NEW.id AND n.id=m.notification_id;
  UPDATE public.transactional_email_jobs SET status='cancelled',available_at=NULL,last_error='invitation resolved'
  WHERE kind='page_team_invitation' AND page_invitation_id=NEW.id AND status IN('pending','processing');
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.retire_page_team_invitation_alert() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER page_team_invitation_alert_resolved AFTER UPDATE OF status ON public.creator_page_team_invitations
 FOR EACH ROW EXECUTE FUNCTION public.retire_page_team_invitation_alert();
CREATE FUNCTION public.get_page_invitation_push_targets(p_notification_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; mode text; enabled boolean;
BEGIN
 SELECT activation_mode,page_invitation_alerts_enabled INTO mode,enabled FROM public.delivery_runtime_config WHERE singleton;
 SELECT coalesce(jsonb_agg(jsonb_build_object('notification_id',n.id,'user_id',n.user_id,'page_id',m.page_id,'invitation_id',m.invitation_id,
 'eligible',coalesce(enabled AND mode<>'quarantined' AND (mode='live' OR EXISTS(SELECT FROM public.delivery_seed_profiles s WHERE s.profile_id=n.user_id))
 AND n.status='unread' AND NOT n.push_suppressed AND n.expires_at>now() AND i.status='pending' AND i.expires_at>now()
 AND i.page_id=m.page_id AND i.recipient_id=m.user_id AND n.user_id=m.user_id
 AND public.creator_page_team_eligible(i.page_id,i.inviter_id,i.recipient_id),false))),'[]') INTO result
 FROM public.app_notifications n JOIN public.page_team_invitation_notifications m ON m.notification_id=n.id
 LEFT JOIN public.creator_page_team_invitations i ON i.id=m.invitation_id
 WHERE n.id=ANY(p_notification_ids) AND n.type='page_team_invitation';
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.get_page_invitation_push_targets(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_page_invitation_push_targets(uuid[]) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_page_invitation_email_jobs(
  p_batch_size integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.transactional_email_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := least(greatest(coalesce(p_batch_size, 10), 1), 100);
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600);
  v_activation_mode text;
BEGIN
  IF NOT coalesce((SELECT page_invitation_alerts_enabled FROM public.delivery_runtime_config WHERE singleton),false) THEN RETURN; END IF;
  SELECT activation_mode INTO v_activation_mode
    FROM public.delivery_runtime_config WHERE singleton;
  IF v_activation_mode IS NULL OR v_activation_mode = 'quarantined' THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH fresh AS (
    SELECT j.id FROM public.transactional_email_jobs j
    WHERE j.kind = 'page_team_invitation' AND j.attempts = 0
      AND (
        (j.status = 'pending' AND coalesce(j.available_at, j.created_at) <= now())
        OR (j.status = 'processing' AND j.claimed_at < now() - make_interval(secs => v_lease_seconds))
      )
      AND (
        v_activation_mode = 'live'
        OR EXISTS (SELECT 1 FROM public.delivery_seed_profiles s WHERE s.profile_id = j.user_id)
        OR EXISTS (SELECT 1 FROM public.delivery_seed_jobs s
                    WHERE s.queue_name = 'transactional_email' AND s.job_id = j.id)
      )
    ORDER BY coalesce(j.available_at, '-infinity'::timestamptz), j.id
    LIMIT ((v_limit + 1) / 2)
    FOR UPDATE SKIP LOCKED
  ),
  retries AS (
    SELECT j.id FROM public.transactional_email_jobs j
    WHERE j.kind = 'page_team_invitation' AND j.attempts > 0
      AND (
        (j.status = 'pending' AND coalesce(j.available_at, j.created_at) <= now())
        OR (j.status = 'processing' AND j.claimed_at < now() - make_interval(secs => v_lease_seconds))
      )
      AND (
        v_activation_mode = 'live'
        OR EXISTS (SELECT 1 FROM public.delivery_seed_profiles s WHERE s.profile_id = j.user_id)
        OR EXISTS (SELECT 1 FROM public.delivery_seed_jobs s
                    WHERE s.queue_name = 'transactional_email' AND s.job_id = j.id)
      )
    ORDER BY coalesce(j.available_at, '-infinity'::timestamptz), j.id
    LIMIT (v_limit / 2)
    FOR UPDATE SKIP LOCKED
  ),
  reserved AS (
    SELECT id FROM fresh
    UNION ALL
    SELECT id FROM retries
  ),
  fill AS (
    SELECT j.id FROM public.transactional_email_jobs j
    WHERE j.kind = 'page_team_invitation' AND NOT EXISTS (SELECT 1 FROM reserved r WHERE r.id = j.id)
      AND (
        (j.status = 'pending' AND coalesce(j.available_at, j.created_at) <= now())
        OR (j.status = 'processing' AND j.claimed_at < now() - make_interval(secs => v_lease_seconds))
      )
      AND (
        v_activation_mode = 'live'
        OR EXISTS (SELECT 1 FROM public.delivery_seed_profiles s WHERE s.profile_id = j.user_id)
        OR EXISTS (SELECT 1 FROM public.delivery_seed_jobs s
                    WHERE s.queue_name = 'transactional_email' AND s.job_id = j.id)
      )
    ORDER BY coalesce(j.available_at, '-infinity'::timestamptz), j.id
    LIMIT greatest(v_limit - (SELECT count(*)::integer FROM reserved), 0)
    FOR UPDATE SKIP LOCKED
  ),
  chosen AS (
    SELECT id FROM reserved
    UNION ALL
    SELECT id FROM fill
  )
  UPDATE public.transactional_email_jobs j
     SET status = 'processing',
         attempts = j.attempts + 1,
         claimed_at = now(),
         updated_at = now()
    FROM chosen c
   WHERE j.id = c.id
  RETURNING j.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_page_invitation_email_jobs(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_page_invitation_email_jobs(integer, integer)
  TO service_role;



CREATE FUNCTION public.get_page_invitation_email_dispatch(p_job_id bigint,p_attempt integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.transactional_email_jobs; i public.creator_page_team_invitations; mode text; enabled boolean; email text;
BEGIN
 SELECT * INTO j FROM public.transactional_email_jobs WHERE id=p_job_id AND kind='page_team_invitation' AND status='processing' AND attempts=p_attempt;
 IF NOT FOUND THEN RETURN jsonb_build_object('decision','cancel','reason','claim no longer current'); END IF;
 SELECT activation_mode,page_invitation_alerts_enabled INTO mode,enabled FROM public.delivery_runtime_config WHERE singleton;
 IF NOT coalesce(enabled,false) OR mode IS NULL OR mode='quarantined' THEN RETURN jsonb_build_object('decision','pause','reason','delivery paused'); END IF;
 IF mode<>'live' AND NOT EXISTS(SELECT FROM public.delivery_seed_profiles s WHERE s.profile_id=j.user_id) THEN RETURN jsonb_build_object('decision','pause','reason','outside test recipients'); END IF;
 SELECT * INTO i FROM public.creator_page_team_invitations WHERE id=j.page_invitation_id;
 IF NOT FOUND OR i.recipient_id<>j.user_id OR i.status<>'pending' OR i.expires_at<=now() OR NOT public.creator_page_team_eligible(i.page_id,i.inviter_id,i.recipient_id)
 THEN RETURN jsonb_build_object('decision','cancel','reason','invitation no longer eligible'); END IF;
 -- Same required profile email as existing transactional confirmations. Generic
 -- content only; the link grants no access and requires the intended account.
 SELECT nullif(btrim(p.email),'') INTO email FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.id=j.user_id AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now());
 IF email IS NULL THEN RETURN jsonb_build_object('decision','pause','reason','account email missing'); END IF;
 RETURN jsonb_build_object('decision','deliver','email',email,'invitationId',i.id,'pageId',i.page_id,'userId',j.user_id,'idempotencyKey',j.idempotency_key);
END$$;
REVOKE ALL ON FUNCTION public.get_page_invitation_email_dispatch(bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_page_invitation_email_dispatch(bigint,integer) TO service_role;
COMMIT;
