# Circle leave response and lifetime — September 13

The isolated `useLeaveCircle` now accepts only the server's two confirmed scalar results: `left` and `not_member`. Both keep the existing successful leave behavior. Null, an unexpected string, or a structured response produces a current, retryable error instead of acknowledging the leave or refreshing Chats as if it succeeded.

Each attempt captures its account, optional caller scope and circle ID before React Query schedules the mutation. A read-only auth listener tracks account generations synchronously, including A → B → A inside one render batch. A fresh `getUser` check must match the initiating account before `leave_circle` is dispatched. Unmount, account change and caller-scope retirement stop old continuations and side effects. Same-account token refresh and ordinary rerenders preserve current work.

Current confirmed success still invalidates the initiating user's Circle directory and the existing unread key, and marks the Chats list dirty. Retired results cannot invalidate another account's directory, set the global dirty flag, invoke caller feedback or populate the replacement owner's visible mutation state. Rapid duplicate calls are guarded before the next render. An old finalizer cannot release a newer attempt's guard. Automatic mutation retries are disabled; current auth, transport and response failures can be retried deliberately.

The original `useLeaveCircle(userId)` and `mutate`/`mutateAsync(circleId, options)` interfaces remain supported, with caller-facing scalar results and string variables. An optional `LeaveCircleScope` second parameter accepts a stable `{ userId, isCurrent }` object; `null` explicitly means unavailable. Callers should replace that object when their room, entry or access context changes. `isObsoleteCircleLeave(error)` identifies retired promise completions. Obsolete `mutate` callbacks are silent; callers maintaining their own pending guard can use `mutateAsync` with a matching-attempt `finally` cleanup.

## Verification

`hooks/__tests__/useLeaveCircle.lifetime.test.tsx` passes **44 cases** against the actual hook and a real QueryClient. Synthetic auth and transport are mocked; the repository's test harness blocks network egress. Coverage includes both valid results, malformed receipts, missing and mismatched identities, auth/transport failures and deliberate recovery, queued dispatch, account and caller-scope return, delayed auth/RPC completion, logout, unmount and listener cleanup, duplicate calls, replacement attempts, same-account refresh, and an account transition during success side effects.

The real cache assertions check directory/unread invalidation, isolation from the other account's directory, and unchanged prior plan history. The tests use the actual Chats dirty signal. Full TypeScript and the scoped whitespace check pass.

The original HEAD hook reproduces three selected defects with the same tests: accepting a null response as success, dispatching after an account change before React Query's queued mutation begins, and reviving retained public callbacks after account A → B → A. A temporary Jest transformer substitutes the saved original source; the working source was never reverted.

- [Passing hook test log](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-leave/tests.log>)
- [Original failures](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-leave/original-failures.log>)
- [Baseline provenance](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-leave/provenance.txt>)

Commands used from the isolated workspace:

```sh
./node_modules/.bin/jest --runInBand --ci hooks/__tests__/useLeaveCircle.lifetime.test.tsx
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-circle-leave-agent.tsbuildinfo
git diff --check -- hooks/useLeaveCircle.ts
```

## Boundaries

This hook package changes no SQL, RPC name or parameter, membership policy, read marker, old plan/chat history or production state. `leave_circle` remains the server-authoritative membership transition; `not_member` continues to mean that no joined membership remains. No dependency installation, release, data operation or account mutation was performed.

A dispatched server write cannot be recalled by a local guard. An unknown receipt may follow a committed leave; the hook reports uncertainty and leaves reconciliation to a current refresh or deliberate retry. The established Circle directory/unread/Chats invalidation contract is preserved; detail-cache eviction is not introduced here. Actual caller integration, native device behavior and production transport require their separate checks.
