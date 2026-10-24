# Notification monitoring — October 24, 2026

## Behavior and scope

The monitor accepts only POST with its dedicated `x-run-token`; invalid methods/tokens/configuration are rejected before constructing a privileged database client. OPTIONS returns 204 without privileged work. The three existing diagnostics run independently with bounded reads, recording and alert attempts. A failed diagnostic is unknown, not healthy. Health, successful recording, and email-provider acceptance are reported separately. An outage remains unhealthy even when its alert succeeds; a failed or uncertain alert is not called delivered. Quiet signup volume does not suppress the existing active-subscription floor.

The handler is extracted from the Edge entrypoint so its authorization and failure paths can be tested without service credentials, network access or real emails. Its 24 tests are now part of `qa:notifications`, alongside the existing 12 token/diagnosis tests. Existing diagnostic RPC names, database health/debounce logic and delivery activation remain unchanged.

## Verification

- **36 tests passed with pinned Deno 2.9.5**; Edge entrypoint typecheck passed. Covered unauthorized requests, missing configuration, malformed/failed/hanging diagnostics, failed/hanging records, low volume, unhealthy activity, provider acceptance/rejection/uncertainty, and HTML escaping. No network or email permission is granted to the tests.
- **11 scheduler scenarios passed** against real PostgreSQL in separate temporary databases. The exact review SQL runs unchanged; Cron, Vault and HTTP are recording doubles. The valid case verifies unchanged cadence and unrelated jobs, exact request URL/body/token/timeout, API-role execution denial, and no dispatch after a missing/blank runtime token. Negative cases reject missing/blank/duplicate secrets, missing/duplicate/inactive/changed jobs, an existing wrapper, and an unauthorized executor. Each database was dropped and the dedicated VM stopped.
- This rehearsal is not an actual pg_cron invocation, live Vault/Edge-secret parity, real email delivery, or production diagnostic-shape verification. Read-only inspection of the reviewed September 14 snapshot and the October 6 registration SQL supports the expected diagnostic/record shapes; current deployed definitions still require checking.
- Migration policy passed: scheduler SQL stays under `docs/database/review-only`, outside migration history.

Evidence: `/Users/liz/Desktop/Ops/Audits/2026-10-24-notification-monitor`. The original October 19 patch is preserved and its source worktree remains untouched. Earlier Deno 2.9.4 logs are retained; pinned-runtime reruns supersede them.

## Coordinated production release — not executed

Liz's explicit release approval is required before any production secret, scheduler or function change. Do not deploy the authenticated handler by itself: the existing caller must send the matching token first.

1. Read current `recent_edge_function_failures`, `push_registration_health_v2`, `push_delivery_health` and `record_push_health` definitions/return shapes, current five-minute monitor job, and downstream response consumers. Preserve the current job command and known-good handler as rollback artifacts. Consumers must inspect JSON; HTTP 200 only means the authorized inspection finished.
2. Set the same fresh random value in Edge `MONITOR_PUSH_HEALTH_RUN_TOKEN` and Vault `monitor_push_health_run_token`. Keep it out of source, SQL text, logs and chat.
3. Apply the reviewed scheduler wrapper as postgres while the old handler is still deployed. Confirm its normal scheduled invocation succeeds with the added header.
4. Deploy the authenticated handler with its explicit `verify_jwt = false` configuration; its dedicated token supplies authorization. Verify wrong/missing token refusal and successful ordinary scheduled checks, all three record timestamps and body-level health.
5. Observe successive scheduled runs. If authorization fails, reconcile matching token configuration or restore the preserved old handler/caller pair. Do not remove the new handler's guard as a workaround. If only diagnostic behavior needs reverting, retain method/token authorization while restoring the known check behavior.

The existing database debounce records an alert opportunity before email-provider acceptance. Failed email can therefore suppress the next attempt. This patch reports that failure honestly; it does not provide a durable alert outbox or guaranteed redelivery. Such a change requires a separate acknowledgement/idempotency design and deployed-function inspection.

No production deployment, real alert, native build or app publication occurred in this task.
