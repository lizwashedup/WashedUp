# Direct-apply evidence: ticket_webhook_events confirmation-retry id format fix

This repository-local record preserves the provenance needed by automated release checks.

## Affected file

- `20260902190000_fix_ticket_webhook_events_confirmation_retry_id_format.sql`

## What happened

Live incident, 2026-09-02: Liz's real strut.la ticket purchase got stuck on "confirming your order"
because `ticket_webhook_events_event_id_format`'s CHECK constraint rejected the synthetic
`confirmation_delivery_<order_id>` key `enqueueConfirmationRetry` (in `ticket-inbox-drain`) writes before
every settlement, so the row failed before `settle_ticket_hold` ever ran. Root cause traced directly by
reading the function source, not guessed. The fix (widen the CHECK to accept both the real `evt_` prefix
and the synthetic `confirmation_delivery_` prefix) was verified end to end against a disposable local
Postgres seeded with production's own real constraint definition (pulled live via
`pg_get_constraintdef`) before being handed to Josh: the old constraint reproduced the real failure, the
new one accepted the synthetic id, still accepted real `evt_` ids, still rejected garbage, and a
pre-existing real row survived re-validation.

Josh ran this file's exact SQL directly in the Supabase SQL editor. Verified live afterward, this session,
by direct read-only query against production:

```sql
select pg_get_constraintdef(oid) as def from pg_constraint
where conrelid = 'public.ticket_webhook_events'::regclass
and contype = 'c' and conname = 'ticket_webhook_events_event_id_format';
```

Result: the live constraint now includes the `confirmation_delivery_` branch. Separately confirmed the
real-world effect, not just the schema change: Liz's stuck `checkout.session.completed` event
(`evt_1UBJ2MRjtvAMYRc7Jyp9QVZW`) self-healed on its normal retry cycle, `processed_at` is now set, and her
paid order (`b03f1f15-6e1b-42af-b05a-a86891769ec9`) shows `status = 'paid'` with a real
`stripe_payment_intent_id`. Her confirmation-email retry row processed on its first attempt.

## Correction to the earlier live read of this incident

The first live read of this incident (relayed to Josh mid-incident) said Liz was charged twice. Fuller
data traced after the fix confirms that was wrong: her first checkout attempt
(`35ef5342-d874-494b-819d-366a9f016697`) has a real `stripe_checkout_session_id` but
`stripe_payment_intent_id` is `null`, and no second `checkout.session.completed` webhook event exists
anywhere in `ticket_webhook_events`. That session was never actually completed by Stripe — no real charge
attaches to it. Only the second attempt has a real payment intent and is paid. One real charge, not two.
That first order is left sitting `status = 'pending'` with no payment attached; harmless, but worth a
later cleanup pass (mark abandoned/expired) rather than leaving it pending indefinitely.

## Disposition

Additive, narrow schema fix, already live. No other table or column touched. No refund is owed since only
one real charge occurred.
