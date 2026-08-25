-- Centralizes the admin-alert recipient lookup that 3 live functions
-- (flag_order_for_refund_review, run_signup_watchdog,
-- run_ticket_inbox_watchdog) each currently repeat inline as
--   select id into v_liz from auth.users where email = 'liz@washedup.app'
-- If that address ever changes, all three silently stop alerting anyone
-- forever -- same "absent-Liz = skip" degrade each already has on purpose,
-- just tripled and with no single place to fix it. This migration moves the
-- one email into one config row and has all three read it from there, so a
-- future address change is a one-row UPDATE instead of a 3-function grep.
--
-- Deliberately NOT touched: the actual alert thresholds and cadence (bot-wave
-- 60min/60sec counts, the 6h signup-gap check, the 10min ticket-inbox-stuck
-- age, the 60min re-alert gap, the failed-webhook high-water-mark logic), and
-- the refund-review flagging/idempotency rules in flag_order_for_refund_
-- review. Only the identity-lookup line in each function changes. The
-- migration-time check at the bottom asserts each function's real logic
-- strings are still present, unchanged.
--
-- Separately found, NOT part of this migration: 'liz@washedup.app' is also
-- hardcoded in 4 edge functions (stripe-webhook, notify-plan-posted,
-- cancel-contributor-subscription, monitor-push-health) and in ~13 files in
-- washedup-web, including real admin-route access checks
-- (src/app/admin/layout.tsx, src/app/api/admin/*/route.ts) -- a much bigger,
-- cross-repo, auth-relevant cleanup that does not belong in a narrow SQL
-- migration. Also found: a DIFFERENT hardcoded-email issue,
-- 20260819040000_remove_admin_email_backdoor.sql, already written 2026-08-19,
-- still unapplied -- that one replaces is_admin(uuid)'s hardcoded-email
-- authorization backdoor with the real has_role() check. Distinct bug
-- (authorization, not alert-routing), already fixed on disk, just needs a
-- separate go-ahead to apply. Neither of these is addressed here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_alert_recipients (
  alert_key  text PRIMARY KEY,
  email      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_alert_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_alert_recipients FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_alert_recipients TO service_role;

INSERT INTO public.admin_alert_recipients (alert_key, email)
VALUES ('default', 'liz@washedup.app')
ON CONFLICT (alert_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_admin_alert_recipient_id(p_alert_key text DEFAULT 'default')
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_id    uuid;
BEGIN
  SELECT email INTO v_email FROM public.admin_alert_recipients WHERE alert_key = p_alert_key;
  IF v_email IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM auth.users WHERE email = v_email;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.flag_order_for_refund_review(p_payment_intent_id text, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_liz uuid;
begin
  if p_payment_intent_id is null then
    return 'no_order';                       -- F3: dashboard charges can carry pi = null
  end if;
  if p_payment_intent_id !~ '^pi_' then
    raise exception 'flag: bad payment_intent';
  end if;
  if p_reason is null or char_length(p_reason) = 0 then
    raise exception 'flag: a review reason is required';
  end if;

  select id, status, needs_refund_review into v_order
  from public.ticket_orders
  where stripe_payment_intent_id = p_payment_intent_id
  order by paid_at nulls last
  limit 1;
  if v_order.id is null then
    return 'no_order';
  end if;
  if v_order.status not in ('paid', 'refunded') then
    return 'noop_status';
  end if;

  -- idempotent: keep the FIRST reason + timestamp; a re-flag only re-asserts
  -- the boolean and never re-notifies. never clears an existing review.
  update public.ticket_orders
     set needs_refund_review = true,
         refund_review_reason = coalesce(refund_review_reason, p_reason),
         refund_review_flagged_at = coalesce(refund_review_flagged_at, now())
   where id = v_order.id;

  if not v_order.needs_refund_review then
    -- F6: first flagging notifies the owner durably (SQL-95's admin_alert
    -- pattern; the type-agnostic push trigger carries it; absent-Liz = skip)
    select public.get_admin_alert_recipient_id() into v_liz;
    if v_liz is not null then
      insert into public.app_notifications (user_id, type, title, body, status)
      values (v_liz, 'admin_alert', 'A ticket order needs refund review',
              format('order %s: %s. positions untouched until resolved.', v_order.id, p_reason),
              'unread');
    end if;
  end if;
  return 'flagged';
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_signup_watchdog()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_liz uuid;
  v_60min int; v_60sec int;
  v_actual_6h int; v_expected_6h numeric;
  v_re_alert_bot interval := interval '60 minutes';
  v_re_alert_gap interval := interval '6 hours';
  v_last timestamptz; v_body text;
BEGIN
  SELECT public.get_admin_alert_recipient_id() INTO v_liz;
  IF v_liz IS NULL THEN RETURN; END IF;

  -- ===== BOT-WAVE: >15 in 60 min OR >5 in 60 sec (organic p95=4/hr, max 10/hr) =====
  SELECT count(*) INTO v_60min FROM auth.users WHERE created_at > now() - interval '60 minutes';
  SELECT count(*) INTO v_60sec FROM auth.users WHERE created_at > now() - interval '60 seconds';
  IF v_60min > 15 OR v_60sec > 5 THEN
    SELECT last_alert_at INTO v_last FROM signup_watch_state WHERE alert_kind = 'bot_wave';
    IF v_last IS NULL OR v_last < now() - v_re_alert_bot THEN
      v_body := format('%s signups in 60 min, %s in 60 sec (normal under 4/hr). Possible bot wave, check bot_watch + Twilio Verify.', v_60min, v_60sec);
      INSERT INTO app_notifications (user_id, type, title, body, status)
      VALUES (v_liz, 'admin_alert', 'Signup spike detected', v_body, 'unread');
      INSERT INTO signup_watch_state AS s (alert_kind, last_alert_at, last_value, details)
      VALUES ('bot_wave', now(), v_60min, v_body)
      ON CONFLICT (alert_kind) DO UPDATE
        SET last_alert_at = excluded.last_alert_at, last_value = excluded.last_value, details = excluded.details;
    END IF;
  END IF;

  -- ===== GAP v2: zero signups in 6h while the prior 4 weeks predict >= 6 =====
  SELECT count(*) INTO v_actual_6h FROM auth.users
   WHERE created_at >= now() - interval '6 hours';

  SELECT count(*)::numeric / 4 INTO v_expected_6h FROM auth.users u
   WHERE u.created_at >= now() - interval '28 days' - interval '6 hours'
     AND u.created_at <  now() - interval '6 hours'
     AND (extract(epoch from (now() - u.created_at))::bigint % (7*86400)) < 6*3600;

  IF v_actual_6h = 0 AND v_expected_6h >= 6 THEN
    SELECT last_alert_at INTO v_last FROM signup_watch_state WHERE alert_kind = 'signup_gap';
    IF v_last IS NULL OR v_last < now() - v_re_alert_gap THEN
      v_body := format('Zero signups in the last 6 hours; the prior 4 weeks predict about %s for this window. The signup/OTP path may be broken, verify a live signup.', round(v_expected_6h));
      INSERT INTO app_notifications (user_id, type, title, body, status)
      VALUES (v_liz, 'admin_alert', 'Signups have gone silent', v_body, 'unread');
      INSERT INTO signup_watch_state AS s (alert_kind, last_alert_at, last_value, details)
      VALUES ('signup_gap', now(), 0, v_body)
      ON CONFLICT (alert_kind) DO UPDATE
        SET last_alert_at = excluded.last_alert_at, last_value = excluded.last_value, details = excluded.details;
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_ticket_inbox_watchdog()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_age_threshold constant interval := interval '10 minutes';
  c_re_alert      constant interval := interval '60 minutes';
  v_liz uuid;
  v_stuck int;
  v_oldest_min int;
  v_max_attempts int;
  v_last timestamptz;
  v_body text;
  v_seen bigint;
  v_new_failed int;
  v_open_failed int;
  v_max_id bigint;
  v_kinds text;
begin
  select public.get_admin_alert_recipient_id() into v_liz;
  if v_liz is null then return; end if;

  -- =======================================================================
  -- (1) STUCK: rows the drain has not finished. Behaviour unchanged.
  -- error is deliberately NOT consulted here: the drain writes inert
  -- disposition notes into error on PROCESSED rows.
  -- =======================================================================
  select count(*),
         coalesce(floor(extract(epoch from (now() - min(received_at))) / 60)::int, 0),
         coalesce(max(attempts), 0)
    into v_stuck, v_oldest_min, v_max_attempts
    from public.ticket_webhook_events
   where processed_at is null
     and received_at < now() - c_age_threshold;

  if v_stuck > 0 then
    select last_alert_at into v_last
      from public.ticket_watch_state where alert_kind = 'inbox_age';

    if v_last is null or v_last < now() - c_re_alert then
      v_body := format(
        '%s ticket webhook event(s) unprocessed for over 10 minutes. Oldest %s minutes, most attempts %s. Paid orders are not settling. Check the ticket-inbox-drain logs.',
        v_stuck, v_oldest_min, v_max_attempts);

      insert into public.app_notifications (user_id, type, title, body, status)
      values (v_liz, 'admin_alert', 'Ticket inbox is stuck', v_body, 'unread');

      insert into public.ticket_watch_state as s (alert_kind, last_alert_at, last_value, details)
      values ('inbox_age', now(), v_stuck, v_body)
      on conflict (alert_kind) do update
        set last_alert_at = excluded.last_alert_at,
            last_value    = excluded.last_value,
            details       = excluded.details;
    end if;
  end if;

  -- =======================================================================
  -- (2) FAILED (added 2026-08-14). The gap this function has had since it
  -- was written.
  --
  -- Section (1) can only see rows with processed_at null. The drain's three
  -- real failure paths all STAMP the row processed and move on: the poison
  -- cap (retries exhausted), a completed checkout carrying no hold_id (the
  -- buyer was charged and no tickets exist), and a refused settle (money
  -- captured, refund owed). A stamped row is outside section (1)'s window by
  -- definition, so all three were invisible, and the poison cap stamped at
  -- about minute 6 while section (1) only looks past minute 10.
  --
  -- Driven by alert_state, which the drain sets explicitly. Never parsed out
  -- of the error text. Keyed off a high-water mark on id so each new failure
  -- alerts exactly once rather than nagging hourly forever, since these rows
  -- stay failed until a human clears them.
  -- =======================================================================
  select coalesce(last_seen_id, 0) into v_seen
    from public.ticket_watch_state where alert_kind = 'inbox_failed';
  v_seen := coalesce(v_seen, 0);

  select count(*) filter (where id > v_seen),
         count(*),
         coalesce(max(id), v_seen)
    into v_new_failed, v_open_failed, v_max_id
    from public.ticket_webhook_events
   where alert_state = 'open';

  if v_new_failed > 0 then
    select string_agg(t, ', ' order by t) into v_kinds
      from (select distinct type as t
              from public.ticket_webhook_events
             where alert_state = 'open' and id > v_seen) k;

    v_body := format(
      '%s ticket webhook event(s) FAILED and were abandoned (%s). %s total still open. These will not retry: a buyer may have been charged with no tickets issued, or a refund may be owed. Check ticket_webhook_events where alert_state = ''open'', then set it to ''ack'' once handled.',
      v_new_failed, coalesce(v_kinds, 'unknown'), v_open_failed);

    insert into public.app_notifications (user_id, type, title, body, status)
    values (v_liz, 'admin_alert', 'Ticket webhook events FAILED', v_body, 'unread');

    insert into public.ticket_watch_state as s (alert_kind, last_alert_at, last_value, details, last_seen_id)
    values ('inbox_failed', now(), v_open_failed, v_body, v_max_id)
    on conflict (alert_kind) do update
      set last_alert_at = excluded.last_alert_at,
          last_value    = excluded.last_value,
          details       = excluded.details,
          last_seen_id  = excluded.last_seen_id;
  end if;
end;
$function$;

DO $$
BEGIN
  IF to_regclass('public.admin_alert_recipients') IS NULL THEN
    RAISE EXCEPTION 'admin_alert_recipients table is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_alert_recipients WHERE alert_key = 'default' AND email = 'liz@washedup.app') THEN
    RAISE EXCEPTION 'admin_alert_recipients is not seeded with the expected default row';
  END IF;
  IF to_regprocedure('public.get_admin_alert_recipient_id(text)') IS NULL THEN
    RAISE EXCEPTION 'get_admin_alert_recipient_id helper is missing';
  END IF;

  IF position('liz@washedup.app' IN pg_get_functiondef('public.flag_order_for_refund_review(text, text)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'flag_order_for_refund_review still has the email hardcoded';
  END IF;
  IF position('get_admin_alert_recipient_id' IN pg_get_functiondef('public.flag_order_for_refund_review(text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'flag_order_for_refund_review was not switched to the centralized lookup';
  END IF;
  IF position('refund_review_reason = coalesce(refund_review_reason, p_reason)' IN pg_get_functiondef('public.flag_order_for_refund_review(text, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'flag_order_for_refund_review lost its keep-first-reason idempotency rule';
  END IF;

  IF position('liz@washedup.app' IN pg_get_functiondef('public.run_signup_watchdog()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'run_signup_watchdog still has the email hardcoded';
  END IF;
  IF position('get_admin_alert_recipient_id' IN pg_get_functiondef('public.run_signup_watchdog()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'run_signup_watchdog was not switched to the centralized lookup';
  END IF;
  IF position('v_60min > 15 OR v_60sec > 5' IN pg_get_functiondef('public.run_signup_watchdog()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'run_signup_watchdog lost its bot-wave threshold';
  END IF;
  IF position('v_actual_6h = 0 AND v_expected_6h >= 6' IN pg_get_functiondef('public.run_signup_watchdog()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'run_signup_watchdog lost its signup-gap threshold';
  END IF;

  IF position('liz@washedup.app' IN pg_get_functiondef('public.run_ticket_inbox_watchdog()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'run_ticket_inbox_watchdog still has the email hardcoded';
  END IF;
  IF position('get_admin_alert_recipient_id' IN pg_get_functiondef('public.run_ticket_inbox_watchdog()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'run_ticket_inbox_watchdog was not switched to the centralized lookup';
  END IF;
  IF position('interval ''10 minutes''' IN pg_get_functiondef('public.run_ticket_inbox_watchdog()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'run_ticket_inbox_watchdog lost its stuck-age threshold';
  END IF;
  IF position('alert_state = ''open''' IN pg_get_functiondef('public.run_ticket_inbox_watchdog()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'run_ticket_inbox_watchdog lost its failed-event check';
  END IF;
END $$;

COMMIT;
