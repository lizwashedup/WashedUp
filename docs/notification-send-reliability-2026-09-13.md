# Notification send reliability — isolated candidate

This package fixes three demonstrated failure paths in the existing sender. It does not change notification copy, recipients, application gates, the database schema, or the chosen OneSignal direction. All provider and database interactions in verification are synthetic. No function was deployed or live push sent.

## Result

- A failed notification-expiry sweep now returns 503 before audience discovery or claiming. The saved claim definition does not independently filter `expires_at`, so proceeding after that failure could send expired alerts.
- A malformed or incomplete OneSignal success response now remains unresolved and releases that notification for a later send pass. It is no longer silently counted as a recipient with no subscription.
- If releasing failed claims is itself rejected or throws, the response now reports 503 with the failed count and an explicit error. It does not report ordinary completion while the notification remains claimed.

Created messages and confirmed empty audiences remain excluded from claim release. The current recipient aliases, title/body, source identifiers, badge values, atomic claim helper and stable per-notification idempotency key are preserved.

## Provider contract and interpretation

[OneSignal's HTTP response schema](https://documentation.onesignal.com/reference/push-notification) distinguishes a created message ID from an explicit empty ID when no subscriptions match. Its SDK examples use broader falsy-ID handling. This direct-HTTP implementation conservatively treats only the explicit empty string as the terminal empty-audience outcome. Missing IDs, arrays, null bodies, invalid JSON and unexpected types remain unconfirmed. That is a deliberate recovery policy, not a claim that OneSignal can never omit an ID.

A nonempty message ID counts provider creation, including a response with partial-recipient errors. It does not prove that a particular phone displayed the notification. The existing `sent` response field retains that meaning for compatibility.

[OneSignal idempotency](https://documentation.onesignal.com/reference/idempotent-notification-requests) deduplicates repeated creation requests using the same key for 30 days. The existing notification UUID is retained on retry. This protects creation retry; it is not a delivery guarantee or a new notification retry scheduler.

## Verification

The actual Edge handler is loaded into a Node VM after TypeScript stripping, with synthetic environment, Supabase, fetch and timers. The suite exercises the real handler body rather than a copied sending loop. The original source reproduced three failures: expiry handling, unknown successful receipts, and failed claim release. After repair, all 12 handler tests pass; four classifier tests also pass.

```sh
node --test supabase/functions/_tests/oneSignalCreateResult.test.mjs supabase/functions/_tests/sendPushNotifications.test.mjs
```

Coverage includes unauthorized calls making no database/provider operations; returned and thrown expiry errors; malformed and unreadable receipts; returned and thrown release errors; a confirmed empty audience; created-message payload preservation; retry identity; accepted peers not being requeued; and existing transport routing.

Evidence: [original failures](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/notification-reliability/send-push-handler-baseline-2026-09-13.log>) and [passing actual-handler suite](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/notification-reliability/send-push-handler-final-2026-09-13.log>). Node is v25.8.1. Deno is unavailable; this is not a Deno runtime, hosted-function or database integration check. App TypeScript excludes Edge functions.

## Remaining integration work

- A process termination after the database claim can still strand a row. Correct recovery requires a rehearsed claim/lease contract; a JavaScript error check cannot repair a killed process. Returning a failure also does not prove the database trigger will automatically retry.
- Existing topic/community mute rules and source-aware reaction policy still need reconciliation at fanout, claim and retry. The draft policy evaluator remains unwired because the mixed legacy community source does not yet reliably identify the intended room.
- Keep the existing OneSignal-only cutover work in the release plan. This patch preserves the legacy routing branch solely to avoid silently dropping an unverified recipient population; no new Expo functionality was added. The test route uses synthetic tokens and no network.
- The saved run-token deployment prerequisite still applies: the Edge function and its calling database trigger must agree. Do not deploy the sender alone.
- Native identity binding, notification tap destinations, physical-device consent/foreground/background behavior and delivery receipts require their own integration evidence. This package makes no fleet-delivery claim.

Current source touched: `supabase/functions/send-push-notifications/index.ts`, `_shared/oneSignalCreateResult.ts`, `_tests/oneSignalCreateResult.test.mjs`, and the new actual-handler `_tests/sendPushNotifications.test.mjs`.
