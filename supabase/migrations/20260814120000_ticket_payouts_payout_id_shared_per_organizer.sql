-- 20260814120000_ticket_payouts_payout_id_shared_per_organizer.sql
-- STATUS: NOT APPLIED. Nothing in this file has been run against any database.
--
-- WHY: ticket-payout-release records ONE ticket_payouts row PER EVENT but makes
-- ONE Stripe payout per ORGANIZER, then writes that single po_ id across every
-- one of that organizer's event rows:
--     .update({ stripe_payout_id: payout.id }).in('event_id', writtenEventIds)
-- The live table carried `ticket_payouts_payout_unique UNIQUE (stripe_payout_id)`,
-- which forbids exactly that. Verified live 2026-08-14: the constraint is NOT
-- deferrable, so the whole multi-row UPDATE aborts atomically with 23505 and NO
-- row is marked released, after the real money has already left Stripe.
--
-- Not fired yet only because every organizer paid so far had exactly one event
-- (ticket_payouts holds 1 row total, verified live 2026-08-14).
--
-- SAFETY: verified live that nothing depends on the dropped constraint - no
-- foreign key references ticket_payouts, and no Postgres function uses
-- ON CONFLICT on stripe_payout_id or names the constraint. The replacement is
-- still a btree index led by stripe_payout_id, so the drain's
-- `.eq('stripe_payout_id', po_id)` lookup keeps its index.
--
-- NOTE ON STRENGTH, stated honestly: (stripe_payout_id, event_id) adds no
-- protection beyond the existing ticket_payouts_one_per_event UNIQUE (event_id),
-- because event_id is already unique table-wide. Its real jobs are to stop
-- forbidding the correct write and to keep serving the webhook lookup. The
-- invariant it cannot express (a payout id must belong to only ONE organizer)
-- is left to application code.

BEGIN;

ALTER TABLE public.ticket_payouts
  DROP CONSTRAINT ticket_payouts_payout_unique;

ALTER TABLE public.ticket_payouts
  ADD CONSTRAINT ticket_payouts_payout_event_unique
  UNIQUE (stripe_payout_id, event_id);

COMMIT;
