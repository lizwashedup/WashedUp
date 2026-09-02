-- =========================================================================
-- LIVE INCIDENT FIX, 2026-09-02. NOT YET APPLIED. Direct SQL is the only
-- path here (same as every other file in this tree touching
-- ticket_webhook_events): apply by running this exact statement in the
-- Supabase SQL editor, or via a linked CLI write, not `supabase db push`.
--
-- Real production bug, confirmed live: every paid ticket checkout with a
-- valid hold_id and a real buyer email/order_id calls enqueueConfirmationRetry
-- (supabase/functions/ticket-inbox-drain/index.ts) BEFORE settle_ticket_hold,
-- inserting a durable delivery-outbox row keyed
-- `confirmation_delivery_<order_id>`. That insert has failed 100% of the
-- time since this table's own CHECK constraint requires stripe_event_id to
-- start with `evt_` -- the real-Stripe-id shape -- which this synthetic key
-- never matches. Because the enqueue happens before settlement and its
-- failure short-circuits the row (recordRetryable + continue), the order
-- never reaches settle_ticket_hold at all: the buyer is charged, Stripe's
-- webhook is marked retryable, and the order sits "pending" forever, retried
-- every cycle, until it hits the 60-attempt poison cap.
--
-- This was never a deliberate id-shape restriction on this synthetic retry
-- key -- the code's own comment already documents the actual intent
-- (uniqueness + never colliding with a real evt_... id, ticket-inbox-
-- drain/index.ts near enqueueConfirmationRetry) -- so this widens the
-- constraint to accept both real Stripe ids and this one documented
-- synthetic shape, instead of loosening it generally.
--
-- Additive and narrow: replaces one CHECK constraint on one column. No data
-- is touched, no other column or table is affected. Existing rows are
-- unaffected either way since every existing stripe_event_id already
-- satisfies the old constraint (real evt_... ids), so re-validation on
-- ADD CONSTRAINT cannot fail.
-- =========================================================================

begin;

alter table public.ticket_webhook_events
  drop constraint ticket_webhook_events_event_id_format;

alter table public.ticket_webhook_events
  add constraint ticket_webhook_events_event_id_format
  check (
    (
      stripe_event_id like 'evt\_%' escape '\'
      or stripe_event_id like 'confirmation\_delivery\_%' escape '\'
    )
    and char_length(stripe_event_id) >= 5
    and char_length(stripe_event_id) <= 255
  );

commit;

-- After this runs: the drain's normal retry cycle (attempts are paid once
-- per minute per the sibling migration's own comment) should pick up every
-- currently-stuck pending row on its own and settle it -- no manual
-- settlement needed. Confirmed live 2026-09-02: exactly 2 rows are stuck on
-- this right now (both Liz's own strut.la purchase attempts, 6 minutes
-- apart, both under the poison cap at 8/60 attempts), so watch for both to
-- clear on their own within a few minutes of this landing. She was charged
-- for both attempts -- refunding one of the two duplicate charges is a
-- separate, human money decision, not part of this fix.
