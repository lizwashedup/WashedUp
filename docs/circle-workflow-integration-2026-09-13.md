# Circle chat workflow integration — September 13

The isolated Circle chat now keeps its metadata, add-people sheet and plan composer tied to the account, room and opening that initiated them. This repairs concrete stale-data and unfinished-action defects; it adds no new product features.

## Behavior

- `useCircle` waits for a confirmed viewer and uses a Circle-only shared identity generation per QueryClient. Enabled observers share one initial account read/listener. A card that needs no Circle details starts neither. Same-account token refresh and staggered observers share the current warm or pending Circle query. Existing mutation invalidation prefixes continue to work.
- Once the final enabled observer leaves, the listener is removed and the generation retires. Reopening revalidates instead of reusing a cache from an interval when no observer could see account changes. Rendering a current warm query does not depend on a layout-effect ref update; callbacks still retain their own visit checks.
- Account A's details cannot appear while account B loads. A response retired by A → B → A cannot become the new visit's data. A failed access refresh hides the cached details, and a current retry can recover them.
- The chat parent supplies the same readable entry scope to both child workflows. An ordinary metadata refresh keeps that scope stable, preserving selections and drafts. Account, room, or access-error changes retire it.
- Adding people retains the existing Your People and server membership rules. Selection reads and submission callbacks cannot escape into a reopened sheet or another account. Duplicate taps are guarded synchronously, and retryable failures remain visible. A slow network does not trap the user: dismissing the sheet retires its UI callbacks without claiming to cancel an already-dispatched add.
- Circle plan creation captures its account and chosen recipients before asynchronous work begins. Old completion cannot clear a newer draft or navigate from a newer entry. A valid current success retains the original close-then-navigation behavior. Cancel still works while identity is unavailable.

Both the Circle chat and Circle detail parents now provide the same stable scope to their child sheets. Detail-page opens, closes, posted-plan navigation, naming gates, error retry and leave-result UI retain their initiating entry. An ordinary metadata refresh preserves open forms; account, room or access-error changes retire old callbacks.

## Verification

The final combined local package passes **120 tests across 7 suites**: 20 Circle query cases, 21 Circle chat parent cases, 17 detail parent cases, 34 add-people cases, and 28 plan-creation cases. Full TypeScript passes, and scoped diffs pass whitespace checks. This supersedes the initial 94-case integration run.

The original `useCircle` source reproduces three selected defects: reading before identity is ready, using the old unscoped cache, and exposing account A's cached data during the switch to B. The test uses an awaitable PostgREST-style mock in both the original and repaired runs. The original source is substituted by a temporary Jest transformer; the working source is not reverted for the comparison.

Independent integration review then reproduced the per-mount generation/disabled-card defects and caught a warm-cache render that waited unnecessarily for another query notification. Those cases now pass with staggered observers, final-observer cleanup, a late initial read, room return, and same-account cache sharing. The separate original plan-creation source reproduces 23 failures and the original detail parent 15; saved logs retain the exact tests rather than treating those numbers as production incidents.

The tests exercise actual components/hooks with synthetic auth and transport. Query tests use a real QueryClient. They do not establish production delivery or physical-device performance.

- [Saved combined test log](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-workflows/tests.log>)
- [Original query failures](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-workflows/query-baseline.log>)
- [Add-people details](circle-add-people-lifetime-2026-09-13.md)
- [Plan-creation details](circle-plan-creation-lifetime-2026-09-13.md)
- [Native review readiness](native-chat-readiness-2026-09-13.md)

## Preserved boundaries

No production operation, migration, provider setting, release or account change was made. The current Circle RPCs, admission and recipient rules, plan visibility/cap choices, original routes and staged-design gate remain. A write already dispatched to a server cannot be recalled by a local lifetime guard; durable idempotency/reconciliation remains a separate server concern.

The detail parent's naming and leave-result UI guards do not replace an audit of `NameCircleSheet` or `useLeaveCircle` internals. Those underlying mutation/cache paths were not rewritten in this package.

Ordinary iOS/Android emoji entry continues to use the system keyboard. Message reactions remain. Native keyboard, real recording, background/reconnect and device accessibility checks must be demonstrated separately.

The saved isolated simulator build installed successfully, and the native fixture bundle and font asset compiled/served locally. Native launch is unconfirmed because the available simulator UI controls could not activate Safari's launch prompt. This is documented in the readiness note; compilation and installation are not counted as keyboard/scroll verification.


## Follow-up completed

The formerly unaudited naming and leave internals are now covered by the September 13 [identity and leave integration package](circle-identity-and-leave-integration-2026-09-13.md): 145 focused checks, actual naming-sheet browser proof, current-scope detail/inbox integration and optional staged appearance. The earlier 120-test result above describes its own package and is not an additional combined-suite claim.
