# Private Circle identity save recovery

The fictional native baseline saved a newer Circle name after Cancel/re-entry, then a delayed original request replaced that name. The same ordering reproduced against the repository's `update_circle` function in disposable PostgreSQL 17. This is not evidence of a production occurrence.

The identity editor now waits at most 12 seconds for each network stage. An unresolved dispatched save retains its exact account, Circle, request ID, starting revision and original identity in local storage. Reopening checks that marker instead of starting another save. Check save status performs a read. A missing receipt leaves the original unresolved. An explicit Retry original save reuses its original request and payload. A definitive first refusal allows a new explicit save. Late results do not close or navigate a retired editor.

The held `save_circle_identity_once` function uses an account-owned immutable receipt and a transaction lock for exact retries. A Circle row lock and revision comparison reject a save overtaken by another session. Successful identity changes update the row once; exact replays and conflicts do not emit another Circle update. The existing `update_circle` function remains available unchanged to legacy callers and optional creation setup. The new function preserves its admin predicate, trimmed/nonempty name behavior, null-description preservation and cover precedence, without altering membership, roles or room settings. The revision comparison applies to the new request path; it does not retroactively add conditional writes to old clients.

Conflict feedback remains visible until Close. The editor then refreshes the detail and directory. Refreshing before that acknowledgement could retire the unnamed-Circle editor before its explanation was readable.

## Verification

- Focused hook, editor, shared account lifecycle and persistent attempt tests.
- Disposable PostgreSQL 17 verifies concurrent exact requests, invisible in-flight receipts, stale revisions, replay after a newer save, changed-payload rejection, cover handling, admin and receipt grants, one row update per successful operation, and legacy update compatibility.
- Fictional iPhone 13 iOS 17.5 uses actual Circle detail, Name this circle, Cancel/re-entry, status checks, explicit retry and Yours directory. Evidence is under `/Users/liz/Desktop/WashedUp/Implementation/member-circle-name-pending-return-20261106`.

## Release prerequisite

Both client and SQL remain private. Before rollout, separately verify `20261107015500_circle_identity_receipts.sql` on an approved production-schema copy, including the actual Circle admin predicate, identity update rules, row triggers, `updated_at` behavior and role grants. The receipt table has no direct authenticated/anonymous privileges. Verify account/Circle deletion cascades and that any deployed row trigger preserves a distinct revision. Deploying the client without the new RPCs would safely refuse saves; there is deliberately no unsafe fallback to the legacy unconfirmed write. Obtain separate rollout approval. Existing schema holds and the App Store rebuild hold remain in force.
