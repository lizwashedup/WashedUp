# Private Circle plan posting recovery

An actual fictional Circle plan stayed pending after 31 seconds. Closing and reopening the composer permitted a second create; releasing both requests displayed two identical cards. The checked-in PostgreSQL create function also produced two distinct events and separate local system-message rows. This is local evidence, not a claim about production.

The composer now stops waiting after 12 seconds and preserves an exact, account-and-Circle-owned request across visits and app restarts. Check status is read-only. An explicit retry reuses the original request and full payload, including audience, photo and message. A known in-flight transport stays locked until it settles or its receipt is confirmed. An empty status read never proves that a pending write cannot arrive. Current draft edits survive recovery of the earlier post; retired visits cannot navigate or request a notification invitation.

The held `create_circle_plan_once` wrapper serializes each account/request pair, verifies an immutable payload and delegates the actual plan, participant and system-message writes to the existing `create_circle_plan` function in the same transaction. Exact replay returns the original event and authoritative chat flag. A fresh explicit post after confirmation has a new request ID, permitting intentional separate plans. Receipts are inaccessible as direct table reads/writes to members and remain when an event is deleted, preventing its recreation on replay.

Validation: 158 focused tests in five suites, TypeScript, and disposable PostgreSQL 17.11 checks for overlapping requests, invisible uncommitted receipts, exact replay, changed payload refusal, membership and receipt permissions, separate plans, deleted events, DM capacity and subset behavior. Native iPhone 13 iOS 17.5 verification is recorded in the external evidence folder; remaining cases and full Regression Lock are tracked there rather than implied complete by this document.

Evidence: `/Users/liz/Desktop/WashedUp/Implementation/member-circle-plan-pending-return-20261106`.

## Release hold

`docs/database/review-only/20261107023500_circle_plan_post_receipts.sql` is explicitly held and excluded from active migration inventory. Before any separately approved rollout, verify the deployed create function, membership/trust predicates, audience/DM rules, message/notification triggers, grants and transaction behavior on an approved production-schema copy. No fallback to the old non-idempotent create operation. Existing App Store, design-integration and other schema holds remain.
