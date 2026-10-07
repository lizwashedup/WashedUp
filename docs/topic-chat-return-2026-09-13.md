# Topic chat read lifetime — isolated repair, September 13, 2026

This package changes only newest/older reads, their reconciliation and realtime refresh ownership in `hooks/useTopicChat.ts`. It does not change message storage, send/edit/delete/reaction transport, membership gates, notification delivery, or the hook's account-observation policy. Existing unrelated working-tree changes remain preserved.

## Demonstrated failures

The initial actual-hook regression run failed **16 of 17 cases** before the source repair. The hook accepted old newest responses and errors after a later refresh, let an old foreground `finally` clear current loading, and left initial loading active when a faster silent realtime refresh completed first. Topic-ID equality also let old results and errors become valid again after A → B → A.

Older-page state shared a lock across visits without resetting it. A pending read in A could block pagination in B, then its `finally` could release B's new lock. An obsolete older result could append stale rows and replace pagination state after a newer refresh. Retained callbacks could start reads after unmount, and an already pending newest read continued into the hook's secondary block lookup after unmount.

The first regression set also demonstrated a refreshed newest page resetting an already exhausted older-history state, and a newest snapshot removing a send whose receipt had resolved while the read was pending. The test for preserving filtered history and its raw cursor already passed and remains in the suite.

Two later boundary regressions exposed an obsolete older-page error after a concurrent newest read replaced the cursor, and a newly returned row from a sender caught by the existing hook-level block lookup. Both are covered in the final suite. Review then added two failing regressions for silent realtime refreshes cancelling an in-flight older page, before and after earlier history had already been loaded. The final repair preserves that pagination lock and cursor through successive message/reaction refreshes.

A final performance review reproduced the unbounded realtime path: 30 events during a slow initial read started 31 total newest reads (initial plus 30 automatic reads). Five of seven focused burst/queue tests failed before coalescing. Later event requests repeatedly invalidated the earlier snapshots, so a steady stream could delay visible updates until it quieted down.

## Read ownership and preservation

- `roomGeneration` and `isCurrentRoom` identify one committed visit, with cleanup retiring that visit. Returning to the same topic ID creates a different generation. No-ID state clears read state and does not fetch.
- Newest requests have a sequence number. The current visit and current newest sequence must still match before secondary work, committing messages/paging state, reporting errors and settling loading. Explicit refresh calls retain their existing supersession behavior, including loading/error ownership. The message and reaction subscription filters are unchanged; retired callbacks cannot start a refresh.
- Realtime events set a per-committed-visit pending flag. At most one automatic newest read runs, with one queued catch-up for events received during it. Catch-up starts from a React effect after the accepted snapshot commits, so successive events cannot keep invalidating the snapshot that just completed. Automatic work waits behind an active initial or explicit read; explicit calls can still supersede older requests. Queue finalizers check the exact visit queue object before waking it, so teardown/restart and A → B → A cannot release or drain a later queue.
- An automatic read failure preserves the displayed history and the existing error state. It runs one catch-up only if another event was already queued; otherwise it waits for a later event or an explicit retry. No timer, debounce interval, unbounded overlap or automatic failure-retry loop was added.
- Older reads own a separate request number, visit and raw compound cursor. An explicit foreground refresh supersedes pending older reads and releases their old loading state. Silent message/reaction refreshes retain the in-flight page and its lock while more history exists, including the first older page; they do not force pagination to restart in a busy room. A newest snapshot that replaces the cursor (for example, no further raw history) makes that older result/error obsolete. Only the owning read can clear its pagination lock; stale results and errors cannot affect a later visit or request. Explicitly superseded pagination remains available to retry from the retained/current cursor; it is not automatically reissued.
- Newest reconciliation replaces unchanged rows inside the existing newest-page window, retains loaded older history and local changes made during the read, and preserves confirmed sends that appeared after the snapshot began. Pending sends still use exact client UUIDs, and an authoritative server row for that UUID wins over its pending representation. No content-based matching was introduced.
- Pagination keeps its existing raw `(created_at, id)` cursor, including pages filtered to zero visible rows. An exhausted older cursor remains exhausted when a newest refresh merely reports additional raw rows before its own newest window. Older-page merging does not overwrite or resurrect a row changed/removed locally while that read was pending.
- The existing hook block lookup applies its returned set to both retained and incoming rows. `getTopicMessages` keeps its existing mutual-block filtering and all of its queries. No new source or lookup call was added.

Read ownership prevents stale application of results; it does not cancel underlying `getTopicMessages` work that was already in progress. Its internal source reads and enrichment are unchanged.

## Local validation

`hooks/__tests__/useTopicChat.refresh.test.tsx` exercises the actual hook with deferred mocked reads, mocked realtime callbacks and mocked send receipts. Final coverage includes 30 cases for refresh ordering, errors/loading, burst coalescing and progressive snapshots, explicit retry priority, automatic failure/catch-up behavior, A → B → A, secondary lookup timing, paging locks/cursors through repeated silent message/reaction refreshes, unmount and absent IDs, raw filtered pages, block-result preservation, and two independent pending UUIDs.

```sh
./node_modules/.bin/jest --runInBand --ci --detectOpenHandles --cacheDirectory=/private/tmp/washedup-topic-return-agent-jest hooks/__tests__/useTopicChat.refresh.test.tsx lib/__tests__/topicPendingMessages.test.ts lib/__tests__/topicSendReceipt.test.ts components/chat/__tests__/ChatUxContract.test.ts
```

Result: **4 suites, 42 tests passed**, exit 0, no open handles reported.

```sh
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-topic-return-agent.tsbuildinfo
```

Result: **exit 0**. Scoped `git diff --check` was clean. Checks used the existing temporary dependency link, with cache/build metadata in `/private/tmp`; no installation or dependency modification. Parent task owns exact-link cleanup.

## Explicit remaining boundaries

This is not a claim that the whole hook is protected against every lifetime race.

- `sendMessage` still uses the original topic-ID comparison and shared pending map for its mutation completion. Old retained send callbacks and A → B → A send completions need their own scoped transport/controller review. This patch only prevents a read snapshot from removing a send confirmed during that read.
- `editMessage` and `deleteMessage` retain their original whole-list rollback snapshots, and `toggleReaction` retains its original shared in-flight set and completion/rollback behavior. They do not receive the new read generation guard in this package. Their scope and concurrent-mutation rollback races remain open work.
- The initial `getUser`/profile effect remains a one-time identity read. This hook does not subscribe to account changes or include an account epoch in read ownership. Account transitions within a mounted topic therefore still need a separate explicit identity contract; room generation alone is insufficient.
- The existing newest-window history policy remains intact. This is not a full-history synchronization algorithm, a backend authorization change, or a deployed sender/receipt change.

No real messages, reactions, provider calls or backend writes were performed. Native navigation, scroll position and keyboard behavior still require device verification; the automated evidence here covers hook state and mocked read ordering.
