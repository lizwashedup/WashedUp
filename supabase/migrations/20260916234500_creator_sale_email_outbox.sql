-- Reuse the existing transactional outbox; old RSVP workers only claim RSVP jobs.
-- Defaults inert. No provider, worker, recurring job or release activation.
BEGIN;
ALTER TABLE public.delivery_runtime_config ADD COLUMN sale_alerts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.transactional_email_jobs
 DROP CONSTRAINT transactional_email_jobs_kind_check,
 ADD CONSTRAINT transactional_email_jobs_kind_check CHECK(kind IN ('free_event_rsvp','creator_ticket_sale')),
 ADD COLUMN sale_order_id uuid REFERENCES public.ticket_orders(id) ON DELETE CASCADE,
 ADD COLUMN sale_preference_revision uuid,
 ADD CONSTRAINT transactional_email_jobs_sale_shape CHECK(
  (kind='free_event_rsvp' AND sale_order_id IS NULL AND sale_preference_revision IS NULL)
  OR (kind='creator_ticket_sale' AND sale_order_id IS NOT NULL AND sale_preference_revision IS NOT NULL)
 );
CREATE OR REPLACE FUNCTION public.claim_transactional_email_jobs(
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
  SELECT activation_mode INTO v_activation_mode
    FROM public.delivery_runtime_config WHERE singleton;
  IF v_activation_mode IS NULL OR v_activation_mode = 'quarantined' THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH fresh AS (
    SELECT j.id FROM public.transactional_email_jobs j
    WHERE j.kind = 'free_event_rsvp' AND j.attempts = 0
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
    WHERE j.kind = 'free_event_rsvp' AND j.attempts > 0
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
    WHERE j.kind = 'free_event_rsvp' AND NOT EXISTS (SELECT 1 FROM reserved r WHERE r.id = j.id)
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

REVOKE ALL ON FUNCTION public.claim_transactional_email_jobs(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_transactional_email_jobs(integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_creator_sale_email_jobs(
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
  IF NOT coalesce((SELECT sale_alerts_enabled FROM public.delivery_runtime_config WHERE singleton),false) THEN RETURN; END IF;
  SELECT activation_mode INTO v_activation_mode
    FROM public.delivery_runtime_config WHERE singleton;
  IF v_activation_mode IS NULL OR v_activation_mode = 'quarantined' THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH fresh AS (
    SELECT j.id FROM public.transactional_email_jobs j
    WHERE j.kind = 'creator_ticket_sale' AND j.attempts = 0
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
    WHERE j.kind = 'creator_ticket_sale' AND j.attempts > 0
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
    WHERE j.kind = 'creator_ticket_sale' AND NOT EXISTS (SELECT 1 FROM reserved r WHERE r.id = j.id)
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

REVOKE ALL ON FUNCTION public.claim_creator_sale_email_jobs(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_creator_sale_email_jobs(integer, integer)
  TO service_role;


CREATE FUNCTION public.enqueue_creator_sale_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE mode text;
BEGIN
 IF NEW.status IS DISTINCT FROM 'paid' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status='paid' THEN RETURN NEW; END IF;
 END IF;
 SELECT activation_mode INTO mode FROM public.delivery_runtime_config WHERE singleton AND sale_alerts_enabled;
 IF mode IS NULL OR mode='quarantined' THEN RETURN NEW; END IF;
 -- This runs at the sale transition, never when somebody enables a preference.
 -- Capture its revision so opt-out then re-enrollment cannot revive an old alert.
 INSERT INTO public.transactional_email_jobs(kind,idempotency_key,user_id,explore_event_id,
   sale_order_id,sale_preference_revision,available_at)
 SELECT 'creator_ticket_sale','creator-sale/'||NEW.id::text||'/'||s.user_id::text,
   s.user_id,NEW.event_id,NEW.id,s.revision,now()
 FROM public.event_sales_alert_preferences s
 JOIN auth.users u ON u.id=s.user_id
 WHERE s.event_id=NEW.event_id AND s.enabled
   AND public.is_ticketing_organizer(NEW.event_id,s.user_id)
   AND u.email_confirmed_at IS NOT NULL AND nullif(btrim(u.email),'') IS NOT NULL
   AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
   AND (mode='live' OR EXISTS(SELECT FROM public.delivery_seed_profiles p WHERE p.profile_id=s.user_id))
 ON CONFLICT(idempotency_key) DO NOTHING;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION public.enqueue_creator_sale_email() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enqueue_creator_sale_email_trigger AFTER INSERT OR UPDATE OF status ON public.ticket_orders
 FOR EACH ROW EXECUTE FUNCTION public.enqueue_creator_sale_email();

-- The worker must call this immediately before its provider request. No address
-- is persisted in the outbox or exposed through a member/creator endpoint.
CREATE FUNCTION public.get_creator_sale_email_dispatch(p_job_id bigint,p_attempt integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.transactional_email_jobs; o public.ticket_orders; s public.event_sales_alert_preferences;
 u auth.users; title text; mode text; enabled boolean;
BEGIN
 SELECT * INTO j FROM public.transactional_email_jobs WHERE id=p_job_id AND kind='creator_ticket_sale'
  AND status='processing' AND attempts=p_attempt;
 IF j.id IS NULL THEN RAISE EXCEPTION 'Sale alert claim is no longer current' USING ERRCODE='P0001'; END IF;
 SELECT activation_mode,sale_alerts_enabled INTO mode,enabled FROM public.delivery_runtime_config WHERE singleton;
 IF NOT coalesce(enabled,false) OR mode IS NULL OR mode='quarantined' OR (mode<>'live'
   AND NOT EXISTS(SELECT FROM public.delivery_seed_profiles WHERE profile_id=j.user_id)
   AND NOT EXISTS(SELECT FROM public.delivery_seed_jobs WHERE queue_name='transactional_email' AND job_id=j.id)) THEN
  RETURN jsonb_build_object('decision','pause','reason','delivery_inactive');
 END IF;
 -- Bound automatic retries inside the existing provider idempotency window.
 IF j.created_at<=now()-interval '23 hours' THEN
  RETURN jsonb_build_object('decision','cancel','reason','delivery_window_expired');
 END IF;
 SELECT * INTO o FROM public.ticket_orders WHERE id=j.sale_order_id;
 SELECT * INTO s FROM public.event_sales_alert_preferences WHERE event_id=j.explore_event_id AND user_id=j.user_id;
 SELECT * INTO u FROM auth.users WHERE id=j.user_id;
 IF o.id IS NULL OR o.event_id<>j.explore_event_id OR o.status<>'paid' THEN
  RETURN jsonb_build_object('decision','cancel','reason','sale_no_longer_paid');
 END IF;
 IF NOT coalesce(s.enabled,false) OR s.revision IS DISTINCT FROM j.sale_preference_revision
   OR NOT coalesce(public.is_ticketing_organizer(j.explore_event_id,j.user_id),false) THEN
  RETURN jsonb_build_object('decision','cancel','reason','creator_no_longer_eligible');
 END IF;
 IF u.id IS NULL OR u.email_confirmed_at IS NULL OR nullif(btrim(u.email),'') IS NULL
   OR u.deleted_at IS NOT NULL OR u.banned_until>now() THEN
  RETURN jsonb_build_object('decision','cancel','reason','verified_email_unavailable');
 END IF;
 SELECT e.title INTO title FROM public.explore_events e WHERE e.id=j.explore_event_id;
 RETURN jsonb_build_object('decision','deliver','email',btrim(u.email),'eventId',j.explore_event_id,
  'orderId',o.id,'quantity',o.qty,'title',title,'idempotencyKey',j.idempotency_key);
END$$;
REVOKE ALL ON FUNCTION public.get_creator_sale_email_dispatch(bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_sale_email_dispatch(bigint,integer) TO service_role;
COMMENT ON FUNCTION public.get_creator_sale_email_dispatch(bigint,integer) IS
 'Service-only pre-provider eligibility check for an exact current sale-email claim. Does not send or claim delivery.';
COMMIT;
