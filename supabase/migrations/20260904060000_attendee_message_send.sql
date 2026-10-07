-- ISOLATED CANDIDATE: not approved for production.
-- September 16 rollback verification found the inherited notification event_id
-- references Plans, not Scene. Use a distinct explore_event_id foreign key.
-- Must be paired with 20260916124500_attendee_message_atomic.sql; original
-- direct-recipient insert and fanout are superseded by that atomic contract.
-- ============================================================================
-- Liz's decision (2026-09-04, item 6 of the 21-question response batch):
--
--   "Fix the current recipient logic so Message attendees reaches everyone
--   with a ticket or confirmed RSVP, not ticket holders only. Support
--   event-specific opt-out, send through email and push together when
--   available, and cap creators at three manual messages per event per day.
--   Essential operational notices such as cancellations, venue changes, and
--   time changes should remain distinct from promotional messaging."
--
-- THINGS THIS MIGRATION DELIBERATELY DOES NOT DO, flagged up front rather
-- than silently assumed:
--
--   1. It does not lift, or attempt to satisfy, the pre-existing legal hold
--      on this feature's EMAIL leg. lib/featureFlags.ts's
--      EMAIL_ATTENDEES_ENABLED (composer at /app/creator/message, doc 100 #6)
--      already documents that the send "cannot legally fire until counsel's
--      30e conditional clears, WashedUp PBC is seller-of-record with the
--      EIN, and Liz gives the word" (30a data addendum, doc 96 §5). That
--      condition is a business/legal fact, not a schema gap -- nothing here
--      resolves it, and this migration does not add an email dispatch path.
--      "email and push together when available" is honored literally: this
--      ships the real PUSH send; email stays exactly as held as it already
--      was until that separate condition clears and a real dispatch path is
--      built. lib/communities/attendeeMessaging.ts throws loudly rather than
--      silently no-op'ing if EMAIL_ATTENDEES_ENABLED is ever flipped true
--      before that path exists.
--   2. It does not touch the app_notifications.type CHECK constraint. That
--      constraint has already drifted out of tracked history once in this
--      exact codebase: 20260309000001_fix_notification_type_constraint.sql's
--      own header records that a 2026-03-05 migration DROP+ADD'ing it to add
--      'new_message' silently dropped 'invite_accepted', and
--      20260820020000_follower_broadcast_push_fanout.sql separately notes
--      'community_broadcast' is "already valid... confirmed live" with no
--      tracked migration adding it -- i.e. the live constraint has content
--      this repo's tracked SQL cannot fully reconstruct today. Guessing the
--      full current IN (...) list to add 'attendee_message' risks repeating
--      the exact 2026-03-05 incident. fanout_attendee_message_push() below
--      reuses the existing, already-valid 'broadcast' type instead --
--      Scene linkage uses explore_event_id, separate from the existing
--      event_id foreign key to Plans. No notification type is replaced.
--   3. It does not invent an "is this caller the event's organizer" helper
--      beyond what's verifiable here. `is_ticketing_organizer` is referenced
--      by name elsewhere in this codebase but its CREATE FUNCTION body is not
--      present in any tracked migration (same drift class as (2), and the
--      same class of gap 20260904010000_refund_authority_grants.sql flagged
--      for compute_ticket_refund/record_ticket_refund) -- guessing its exact
--      signature/semantics would be guessing at an authorization boundary,
--      which the build directive for money- and access-adjacent code says
--      not to do. attendee_message_is_event_organizer() below instead
--      inlines the ONE organizer predicate this session could actually read
--      and verify: supabase/functions/ticket-refund/index.ts's own
--      organizerId resolution (explore_events.host_user_id, or the fronting
--      community's created_by when host_user_id is null). A real reviewer
--      should confirm this still matches is_ticketing_organizer's behavior
--      before this applies.
--   4. The 3/event/day cap (enforce_attendee_message_daily_cap trigger,
--      below) counts by UTC calendar day, not the creator's local day. Doing
--      this exactly right needs a per-organizer timezone this codebase does
--      not track today -- flagged as a known simplification, not a guess.
--
-- WHAT THIS MIGRATION ADDS
--
--   attendee_message_opt_outs -- one row per (event, user) who opted out of
--     PROMOTIONAL manual messages for that specific event (Liz: "event-
--     specific opt-out"). Essential notices ignore this table entirely --
--     enforced in application code (attendeeMessaging.ts's applyOptOut) and
--     is not re-checked here in SQL, since opt-out is a preference, not a
--     money- or access-control boundary; the daily cap (below) IS re-checked
--     in SQL because it is a creator-facing limit worth defending in depth.
--   attendee_message_sends -- one row per manual message a creator actually
--     sends: audience filter snapshot, resolved recipient_user_ids (already
--     opt-out-applied and cap-checked by the time this inserts -- see
--     attendeeMessaging.ts:sendAttendeeMessage), kind (essential/
--     promotional), and for essential, which of Liz's exact 3 reasons
--     (cancellation, venue_change, time_change). This is both the audit
--     trail and the source fanout_attendee_message_push() reads from -- the
--     RPC does not re-derive recipients, it trusts what's already stored.
--   enforce_attendee_message_daily_cap() -- BEFORE INSERT trigger, defense
--     in depth for the 3/event/day cap: even if application code has a bug
--     or a future caller skips it, the database itself refuses a 4th
--     promotional row for the same (event, creator) UTC day. Essential rows
--     are exempt, matching Liz's "essential... should remain distinct from
--     promotional messaging."
--   fanout_attendee_message_push(uuid) -- SECURITY DEFINER RPC, deliberately
--     thin: given a message id, re-verifies the caller is that message's own
--     creator (defense in depth, mirroring
--     fanout_follower_broadcast_push's re-check of sender_user_id), then
--     inserts one app_notifications row per already-resolved recipient.
--     Wired through the existing OneSignal pipeline (app_notifications ->
--     claim_pending_push_notifications -> send-push-notifications) per
--     Josh's 2026-08-20 ruling for follower broadcasts -- same pipeline,
--     not a new provider.
--
-- House rules honored, matching 20260820020000 / 20260904010000: RLS on,
-- (select auth.uid())-style initplan wrapping avoided only where the
-- function is already STABLE and cheap (documented inline), SECURITY
-- DEFINER re-checks caller identity independently of the RLS that let the
-- row exist, in-transaction self-test with explicit cleanup so it leaves
-- zero trace on apply -- never strip it.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.explore_events') IS NULL
     OR to_regclass('public.communities') IS NULL
     OR to_regclass('public.ticket_orders') IS NULL
     OR to_regclass('public.ticket_order_positions') IS NULL
     OR to_regclass('public.explore_event_rsvps') IS NULL
     OR to_regclass('public.app_notifications') IS NULL THEN
    RAISE EXCEPTION 'attendee message send dependency missing: explore_events/communities/ticket_orders/ticket_order_positions/explore_event_rsvps/app_notifications';
  END IF;
END $$;

-- Preserve the Plan foreign key. Scene notifications need their actual event identity.
ALTER TABLE public.app_notifications
 ADD COLUMN explore_event_id uuid REFERENCES public.explore_events(id) ON DELETE SET NULL;
CREATE INDEX app_notifications_explore_event_idx ON public.app_notifications(explore_event_id) WHERE explore_event_id IS NOT NULL;
COMMENT ON COLUMN public.app_notifications.explore_event_id IS 'Scene event identity; event_id continues to reference a Plan. Attendee-message notification routing must use this field.';

-- ---------------------------------------------------------------------------
-- 0. shared predicate: is auth.uid() this event's real organizer?
-- ---------------------------------------------------------------------------

-- Inlines the one organizer predicate this session could verify by reading
-- real source (ticket-refund/index.ts's organizerId resolution) -- see
-- header point 3. STABLE, not VOLATILE: safe to use in RLS policies without
-- the (select auth.uid()) initplan trick mattering much, since this already
-- does its own single indexed lookup per call.
CREATE OR REPLACE FUNCTION public.attendee_message_is_event_organizer(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.explore_events e
    LEFT JOIN public.communities c ON c.id = e.community_id
    WHERE e.id = p_event_id
      AND (e.host_user_id = p_user_id OR (e.host_user_id IS NULL AND c.created_by = p_user_id))
  );
$$;

REVOKE ALL ON FUNCTION public.attendee_message_is_event_organizer(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.attendee_message_is_event_organizer(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. table: attendee_message_opt_outs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendee_message_opt_outs (
  event_id    uuid NOT NULL REFERENCES public.explore_events(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

ALTER TABLE public.attendee_message_opt_outs ENABLE ROW LEVEL SECURITY;

-- a user manages only their own opt-out (mirrors follower_broadcasts'
-- direct-authenticated-insert precedent, not the heavier refund-grants
-- RPC-only precedent -- opting out of messages is not money- or
-- access-control-adjacent).
CREATE POLICY "users_manage_own_attendee_message_opt_out"
  ON public.attendee_message_opt_outs FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- the event's organizer needs to read opt-outs to exclude them at send time
-- (attendeeMessaging.ts:getOptedOutUserIds runs under the organizer's own
-- session, not service role).
CREATE POLICY "organizer_reads_attendee_message_opt_outs"
  ON public.attendee_message_opt_outs FOR SELECT
  USING (public.attendee_message_is_event_organizer(event_id, (select auth.uid())));

CREATE INDEX IF NOT EXISTS attendee_message_opt_outs_event_idx
  ON public.attendee_message_opt_outs (event_id);

COMMENT ON TABLE public.attendee_message_opt_outs IS
  'Liz decision #6 (2026-09-04): per-event opt-out from PROMOTIONAL manual attendee messages. Essential operational notices (cancellation/venue/time change) ignore this table by design -- enforced in attendeeMessaging.ts, not here.';

-- ---------------------------------------------------------------------------
-- 2. table: attendee_message_sends (audit trail + push fanout source)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendee_message_kind') THEN
    CREATE TYPE public.attendee_message_kind AS ENUM ('essential', 'promotional');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendee_message_essential_reason') THEN
    -- Liz's exact list (decision #6): do not expand without a new decision.
    CREATE TYPE public.attendee_message_essential_reason AS ENUM ('cancellation', 'venue_change', 'time_change');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.attendee_message_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.explore_events(id) ON DELETE CASCADE,
  creator_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind                public.attendee_message_kind NOT NULL,
  essential_reason    public.attendee_message_essential_reason,
  subject             text NOT NULL,
  body                text NOT NULL,
  reply_to            text,
  -- snapshot of the composer's SeatFilter (tier/checkedIn/refunded/search) at
  -- send time, for the audit trail -- not re-read by any query.
  audience_filter     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- already opt-out-applied and cap-checked by attendeeMessaging.ts before
  -- insert; fanout_attendee_message_push() trusts this array as-is rather
  -- than re-deriving it, so there is exactly one place recipient logic lives.
  recipient_user_ids  uuid[] NOT NULL,
  recipient_count     integer NOT NULL,
  push_attempted      boolean NOT NULL DEFAULT false,
  email_attempted     boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(subject) <> ''),
  CHECK (btrim(body) <> ''),
  CHECK (recipient_count = array_length(recipient_user_ids, 1)),
  CHECK (
    (kind = 'essential' AND essential_reason IS NOT NULL)
    OR
    (kind = 'promotional' AND essential_reason IS NULL)
  )
);

ALTER TABLE public.attendee_message_sends ENABLE ROW LEVEL SECURITY;

-- direct-insert precedent (follower_broadcasts), not RPC-only (refund
-- grants): sending a message is not a money-authority grant. RLS is the
-- real boundary here; the daily-cap trigger below is the defense-in-depth
-- layer for the one invariant worth double-checking.
CREATE POLICY "organizer_sends_attendee_messages"
  ON public.attendee_message_sends FOR INSERT
  WITH CHECK (
    creator_user_id = (select auth.uid())
    AND public.attendee_message_is_event_organizer(event_id, (select auth.uid()))
  );

CREATE POLICY "organizer_reads_own_attendee_message_sends"
  ON public.attendee_message_sends FOR SELECT
  USING (creator_user_id = (select auth.uid()));

CREATE INDEX IF NOT EXISTS attendee_message_sends_cap_idx
  ON public.attendee_message_sends (event_id, creator_user_id, kind, created_at);

-- ---- defense-in-depth: the 3/event/day cap, re-checked in SQL -------------
CREATE OR REPLACE FUNCTION public.enforce_attendee_message_daily_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_sent_today integer;
BEGIN
  IF NEW.kind <> 'promotional' THEN
    RETURN NEW; -- essential notices are exempt, per Liz's decision
  END IF;

  SELECT count(*) INTO v_sent_today
  FROM public.attendee_message_sends
  WHERE event_id = NEW.event_id
    AND creator_user_id = NEW.creator_user_id
    AND kind = 'promotional'
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');

  IF v_sent_today >= 3 THEN
    RAISE EXCEPTION 'attendee message daily cap reached: % promotional messages already sent for this event today', v_sent_today;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER attendee_message_sends_daily_cap
  BEFORE INSERT ON public.attendee_message_sends
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendee_message_daily_cap();

COMMENT ON TABLE public.attendee_message_sends IS
  'Liz decision #6 (2026-09-04): audit trail + push-fanout source for manual attendee messages. recipient_user_ids is a resolved, already-opt-out-applied snapshot, not re-derived at read time. Essential (cancellation/venue/time change) sends are exempt from the 3/event/day cap enforced by attendee_message_sends_daily_cap.';

-- ---------------------------------------------------------------------------
-- 3. RPC: push fanout via the existing OneSignal pipeline
-- ---------------------------------------------------------------------------

-- Deliberately reuses the already-valid 'broadcast' app_notifications.type
-- rather than adding a new enum value -- see header point 2.
CREATE OR REPLACE FUNCTION public.fanout_attendee_message_push(p_message_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.attendee_message_sends%rowtype;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.attendee_message_sends WHERE id = p_message_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'message not found';
  END IF;
  -- defense in depth: the INSERT that created this row already enforced
  -- creator_user_id = auth.uid() via organizer_sends_attendee_messages, but
  -- this SECURITY DEFINER function bypasses RLS entirely, so it re-checks
  -- independently rather than trusting the row's own creator_user_id column
  -- alone (same pattern as fanout_follower_broadcast_push's sender re-check).
  IF v_row.creator_user_id <> v_uid THEN
    RAISE EXCEPTION 'not your message';
  END IF;

  INSERT INTO public.app_notifications (user_id, type, title, body, explore_event_id, actor_user_id, status, push_sent, push_suppressed)
  SELECT uid, 'broadcast', v_row.subject, v_row.body, v_row.event_id, v_uid, 'unread', false, false
  FROM unnest(v_row.recipient_user_ids) AS uid
  WHERE uid <> v_uid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fanout_attendee_message_push(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fanout_attendee_message_push(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. in-transaction self-test (never strip on apply)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_organizer uuid;
  v_buyer uuid;
  v_stranger uuid;
  v_event_id uuid;
  v_send_id uuid;
  v_raised boolean;
  v_sent integer;
  v_notif_count integer;
BEGIN
  SELECT id INTO v_organizer FROM auth.users ORDER BY created_at LIMIT 1 OFFSET 0;
  SELECT id INTO v_buyer FROM auth.users WHERE id <> v_organizer ORDER BY created_at LIMIT 1 OFFSET 0;
  SELECT id INTO v_stranger FROM auth.users WHERE id NOT IN (v_organizer, v_buyer) ORDER BY created_at LIMIT 1 OFFSET 0;
  IF v_organizer IS NULL OR v_buyer IS NULL OR v_stranger IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: needs three existing users';
  END IF;

  INSERT INTO public.explore_events (host_user_id, title, event_date, status)
  VALUES (v_organizer, 'selftest attendee message event', now() + interval '3 days', 'active')
  RETURNING id INTO v_event_id;

  -- a stranger cannot insert a send row for someone else's event
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    INSERT INTO public.attendee_message_sends (event_id, creator_user_id, kind, subject, body, recipient_user_ids, recipient_count)
    VALUES (v_event_id, v_stranger, 'promotional', 'hi', 'hi', ARRAY[v_buyer], 1);
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a non-organizer could record a send for someone else''s event';
  END IF;

  -- the real organizer sends 3 promotional messages today -- the 4th is blocked
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  FOR i IN 1..3 LOOP
    INSERT INTO public.attendee_message_sends (event_id, creator_user_id, kind, subject, body, recipient_user_ids, recipient_count)
    VALUES (v_event_id, v_organizer, 'promotional', 'note ' || i, 'body ' || i, ARRAY[v_buyer], 1);
  END LOOP;
  v_raised := false;
  BEGIN
    INSERT INTO public.attendee_message_sends (event_id, creator_user_id, kind, subject, body, recipient_user_ids, recipient_count)
    VALUES (v_event_id, v_organizer, 'promotional', 'note 4', 'body 4', ARRAY[v_buyer], 1);
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a 4th promotional send today was not blocked by the daily cap';
  END IF;

  -- an essential send is exempt from that same cap, same day, same event
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.attendee_message_sends (event_id, creator_user_id, kind, essential_reason, subject, body, recipient_user_ids, recipient_count)
  VALUES (v_event_id, v_organizer, 'essential', 'cancellation', 'cancelled', 'sorry, cancelled', ARRAY[v_buyer], 1)
  RETURNING id INTO v_send_id;
  RESET ROLE;
  IF v_send_id IS NULL THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: an essential send was blocked by the promotional daily cap';
  END IF;

  -- push fanout: the buyer gets exactly 1 app_notifications row; a stranger
  -- cannot fan out push for someone else's message
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_raised := false;
  BEGIN
    PERFORM public.fanout_attendee_message_push(v_send_id);
  EXCEPTION WHEN OTHERS THEN v_raised := true;
  END;
  RESET ROLE;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a non-creator could fan out push for someone else''s message';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.fanout_attendee_message_push(v_send_id) INTO v_sent;
  RESET ROLE;
  IF v_sent <> 1 THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: expected 1 push fanned out, got %', v_sent;
  END IF;

  SELECT count(*) INTO v_notif_count FROM public.app_notifications
  WHERE user_id = v_buyer AND type = 'broadcast' AND actor_user_id = v_organizer AND body = 'sorry, cancelled';
  IF v_notif_count <> 1 THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: buyer did not receive exactly 1 app_notifications row';
  END IF;

  -- opt-out: the buyer opts out; organizer can see it; a stranger cannot
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.attendee_message_opt_outs (event_id, user_id) VALUES (v_event_id, v_buyer);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_organizer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT EXISTS (SELECT 1 FROM public.attendee_message_opt_outs WHERE event_id = v_event_id AND user_id = v_buyer) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: organizer could not see a real opt-out for their own event';
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF EXISTS (SELECT 1 FROM public.attendee_message_opt_outs WHERE event_id = v_event_id AND user_id = v_buyer) THEN
    RAISE EXCEPTION 'SELF-TEST FAIL: a stranger could read another organizer''s opt-out rows';
  END IF;
  RESET ROLE;

  -- cleanup: leave zero trace
  DELETE FROM public.app_notifications WHERE user_id = v_buyer AND actor_user_id = v_organizer AND body = 'sorry, cancelled';
  DELETE FROM public.attendee_message_opt_outs WHERE event_id = v_event_id AND user_id = v_buyer;
  DELETE FROM public.attendee_message_sends WHERE event_id = v_event_id;
  DELETE FROM public.explore_events WHERE id = v_event_id;

  RAISE NOTICE 'attendee_message_send self-test passed';
END;
$$;

COMMIT;
