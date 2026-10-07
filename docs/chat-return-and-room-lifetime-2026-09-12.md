# Chat return and room lifetime repair

Isolated native implementation, September 12. No production release, server write, provider change or real notification test.

## Demonstrated defects

The currently used `useChat` hook fetched the newest page on `refetch(true)` when returning to a conversation, but the authenticated path only hydrated IDs already in the list. Messages missed while away could stay invisible even after a successful read. This is a concrete contributor to a chat appearing stuck; it does not establish every reported freeze's cause.

The same hook used a shared cancellation flag for asynchronous realtime/paging callbacks. A subsequent room visit reset that flag. An old room's pending sender lookup or older-page request could then append into the newer visit; its error/completion could also affect the current pagination state. Returning A → B → A reproduced the same issue.

## Repair

- Every successful newest-page read reconciles the visible list. Older pages remain, missing rows in the refreshed window disappear, and exact client UUIDs reconcile pending sends without content matching.
- Rows inserted, edited or removed while a read is pending retain those concurrent changes. Sender/reaction hydration cannot overwrite a later local edit or a superseding read.
- A distinct room-generation object scopes subscriptions, newest reads, older reads and state commits. An old callback is rejected even when its room ID matches a later visit.
- Pagination's busy/error state belongs to its originating visit. A retired request cannot block or unlock the current visit's older-page request.

Changed files: `hooks/useChat.ts` and `hooks/__tests__/useChat.refresh.test.tsx`. Existing transport/receipt fixes elsewhere in the uncommitted hook predate this package. No change to membership, say-hello, eligibility, expiry, send/reaction policy, routes or chat layout was required.

## Evidence

The original missing-row regression was reproduced before editing. All eleven additional lifetime cases also failed against the pre-lifetime repair. Final coverage is twenty real-hook cases, including missed newest messages, retained history, concurrent edit/insert/delete, missed deletion, refreshed blocking, uncertain loading/retry, exact optimistic UUIDs, superseded reads, A → B → A and retired paging/subscription callbacks.

The hook, compound paging, ChatUxContract and inactive-engine contract suites pass **30/30 tests**. Full TypeScript noEmit and scoped diff checks pass. The helper/contract tests use mocked transport; they do not prove production delivery, native keyboard smoothness or scroll-position behavior.

Command: `jest --runInBand --ci hooks/__tests__/useChat.refresh.test.tsx hooks/__tests__/chatPaging.test.ts components/chat/__tests__/ChatUxContract.test.ts hooks/__tests__/useChatEngine.deadPath.test.ts`.

## Next checks

Verify real-device reconnect/return with actual large histories and keyboard interaction. Audit the separate community/topic hooks and broader identity caches independently. This package scopes room readers; it does not claim every async operation across all chat implementations is covered.
