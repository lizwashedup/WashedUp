# Technical database hardening review notes

Date: 2026-08-24

Status: Local review package only. Nothing in this directory is executable by
the normal migration runner.

## Prepared without a product decision

- Append-only organizer receivable allocations preserve the amount consumed by
  each Stripe payout.
- A payout-consumption receipt makes an exact retry return the original result
  and rejects reuse of the payout ID with different inputs.
- Advisory transaction locks serialize one organizer's FIFO receivable stream.
- Fully offset payout detections become durable, deduplicated operational rows.
  The proposal does not choose a notification recipient or user-facing message.
- Refund-review resolution writes an immutable action before clearing the live
  queue fields. The existing one-argument RPC remains compatible.
- Per-attendee answer validation includes the dynamic lower and upper bounds.
  The captured table already had a static 1 to 50 check, so the live risk was
  lower than the earlier function-only audit suggested.
- Active question writes serialize per event before enforcing the existing
  eleven-question limit.
- Service-side email and phone checks use the same normalization rules as the
  signup triggers.
- Photo hashes are validated as 64 hexadecimal characters and thresholds are
  restricted to their mathematical distance domain.
- Every new operational table has RLS enabled and is granted only to
  `service_role`. Every replaced privileged function explicitly revokes
  `PUBLIC`, `anon`, and `authenticated` execution.

Supabase's 2026 Data API change means new public tables may no longer receive
implicit API grants. This proposal does not rely on that default and explicitly
keeps the new operational tables service-only.

The previously tested automatic-restriction design is preserved separately in
`technical-moderation-alternative.sql`. It is not mounted by the default private
gate and is not part of the autonomous hardening candidate. It is contingent on
Liz choosing the threshold, eligible report classes, duration, and whether the
result is automatic enforcement or a review item.

## Still blocked by missing canonical source or product policy

- The 24 ticketing and payout functions and eight admin or ban functions still
  need a checked-in canonical baseline before any production promotion. The
  point-in-time schema capture is evidence, not migration provenance.
- `admin_ban_user` is not replaced here. Its unbounded private-message snapshot
  needs an explicit retention decision, and its real caller path must be proven
  before changing the transaction.
- Whether report thresholds create a review item or an automatic restriction is
  a Liz moderation decision. The default technical package does not replace the
  automatic-ban function.
- The acceptable operational photo-match threshold is a policy decision. This
  package rejects malformed values but does not invent a stricter product cap.
- Alert recipients and notification copy for blocked payouts and refund reviews
  are not chosen here.
- The hard-coded refund-review email remains unchanged pending approved admin
  routing configuration.
- `price_ticket_checkout` input range changes remain blocked until its canonical
  body and every caller contract are baselined.

## Captured constraints that reduce uncertainty

The 2026-08-24 schema dump includes unique constraints for ticket order hold,
payment-intent, reference, and checkout-session identities; payout event
identity; and Stripe refund identity. Those constraints must be asserted again
against fresh live metadata immediately before promotion.

## Local proof

The private PostgreSQL suite covers:

- FIFO split allocations and later payout provenance;
- exact and mismatched payout replay;
- two-session concurrent payout replay;
- blocked-payout deduplication;
- refund history preservation;
- invalid, valid, and order-scoped attendee indexes;
- a two-session race at the eleven-question boundary;
- Gmail and phone normalization;
- valid and malformed photo hashes and thresholds;
- service-only function ACLs and RLS on new tables.

Rollback before any future release would be a new forward migration that
restores the previously captured function bodies and removes only unused new
objects after confirming no ledger or audit rows were written. Existing applied
migrations must never be edited in place.
