-- =========================================================================
-- NOT YET APPLIED. Nothing in this file has been run against the live
-- database. Direct SQL is the only path here: the CLI migration workflow is
-- broken on this project (task #42, ~280 drifted history entries), so this
-- file is the record of what to run, not something `supabase db push` picks
-- up.
--
-- ORDERING IS LOAD-BEARING: run this BEFORE deploying the patched
-- ticket-inbox-drain. The patched function writes alert_state and
-- last_event_at, and those columns have to exist first. Deploying the
-- function first would make every stamp fail, which leaves rows unprocessed
-- (loud, not silent, the age watchdog would catch it) but it would look like
-- an outage for no reason.
--
-- Everything here is additive: new columns, one partial index, one seeded
-- row, and a CREATE OR REPLACE of a function that already exists. No column
-- is dropped, no existing row is rewritten, no existing value changes
-- meaning.
-- =========================================================================

begin;

-- -------------------------------------------------------------------------
-- 1. ticket_webhook_events.alert_state
--
-- The drain's three real failure paths STAMP processed_at and walk away.
-- run_ticket_inbox_watchdog can only ever see rows with processed_at IS
-- NULL, so those failures were structurally invisible to it: not unlikely to
-- alert, impossible to alert. Worse, the poison cap stamped at about minute
-- 6 (attempts are paid once per minute) while the watchdog's window only
-- opens on rows older than 10 minutes, so it was stamped and gone before the
-- watchdog could look.
--
-- This is an explicit column rather than a marker prefix on `error` because
-- a convention on `error` is precisely what already failed here. The
-- watchdog's own comment says error is deliberately not consulted, because
-- the drain writes inert disposition notes into it on processed rows mixed
-- in with real failures. A column cannot be broken by someone editing a
-- message string.
--
--   null  = nothing to see (successes and inert dispositions)
--   open  = a human has to act, and nothing will retry this
--   ack   = a human has seen it (set by hand until washedup-world has a UI)
-- -------------------------------------------------------------------------
alter table public.ticket_webhook_events
  add column if not exists alert_state text;

alter table public.ticket_webhook_events
  drop constraint if exists ticket_webhook_events_alert_state_check;
alter table public.ticket_webhook_events
  add constraint ticket_webhook_events_alert_state_check
  check (alert_state is null or alert_state in ('open', 'ack'));

create index if not exists ticket_webhook_events_alert_open_idx
  on public.ticket_webhook_events (id)
  where alert_state = 'open';

comment on column public.ticket_webhook_events.alert_state is
  'Set to open by ticket-inbox-drain when an event is abandoned in a way a paying customer would notice: poison cap exhausted, completed checkout with no hold_id, or a refused settle owing a refund. run_ticket_inbox_watchdog alerts on it. Never inferred from the error text.';

-- -------------------------------------------------------------------------
-- 2. ticket_watch_state.last_seen_id, the high-water mark.
--
-- A failed row stays failed until a human clears it, so a count-based alert
-- would re-fire every hour forever and get muted within a day. Keying off
-- the highest id already alerted on means every new failure alerts exactly
-- once. Alert-once is safe here because the alert lands in
-- app_notifications, which is a durable record, not an ephemeral ping.
-- -------------------------------------------------------------------------
alter table public.ticket_watch_state
  add column if not exists last_seen_id bigint;

-- Seed the mark at the CURRENT max id so history can never backfire. There
-- are already 36 historical failures sitting in this table (33x "no
-- organizer row", 1x "completed session without hold_id metadata", 2x "no
-- ledger row", spanning 2026-07-27 to 2026-08-04). If anyone later
-- back-marks those rows alert_state='open' to triage them, this seed is what
-- stops all 36 firing a notification at Liz in one burst.
insert into public.ticket_watch_state (alert_kind, last_alert_at, last_value, details, last_seen_id)
values ('inbox_failed', null, 0, 'seeded at install 2026-08-14; no alert sent',
        (select coalesce(max(id), 0) from public.ticket_webhook_events))
on conflict (alert_kind) do nothing;

-- -------------------------------------------------------------------------
-- 3. organizer_stripe_accounts event ordering.
--
-- Stripe does not guarantee event ORDER. account.updated was applied
-- unconditionally, so two events in flight arriving newest-first replay a
-- stale snapshot over current truth, flipping charges_enabled /
-- payouts_enabled back to a value Stripe has already moved past. An
-- organizer can end up looking payable when Stripe has disabled them.
--
-- default '-infinity' rather than null is deliberate. It means the drain can
-- guard with a single .lte() filter instead of an OR-group carrying a null
-- branch, which keeps the whole check inside ONE update statement's WHERE
-- clause and therefore race-free between two overlapping drain runs.
-- -------------------------------------------------------------------------
alter table public.organizer_stripe_accounts
  add column if not exists last_event_at timestamptz not null default '-infinity'::timestamptz;

alter table public.organizer_stripe_accounts
  add column if not exists last_event_id text;

comment on column public.organizer_stripe_accounts.last_event_at is
  'Stripe event.created of the last account.updated applied to this row. The drain writes only when the incoming event is at least this new, so out-of-order delivery cannot replay stale Connect flags.';

-- -------------------------------------------------------------------------
-- 4. run_ticket_inbox_watchdog, rewritten.
--
-- The original could not simply be appended to: it returned early when
-- v_stuck = 0 (the normal case) and again inside the 60 minute cooldown, so
-- anything added at the bottom would almost never run. Section (1) below is
-- the original stuck-row logic with identical thresholds, message text and
-- state key, just re-nested as an if instead of an early return. Section (2)
-- is new.
-- -------------------------------------------------------------------------
create or replace function public.run_ticket_inbox_watchdog()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  select id into v_liz from auth.users where email = 'liz@washedup.app';
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

commit;
