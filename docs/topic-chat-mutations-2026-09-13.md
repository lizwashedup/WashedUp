# Topic chat mutation lifetime — isolated repair, September 13, 2026

This package changes mutation and account ownership in `hooks/useTopicChat.ts`. Its source operations, table/column names, content filter, 4,000-character bound, client UUIDs, reply/location fields, receipt lookup, own-message filters and one-reaction-per-user behavior remain intact. No live database, authentication session, provider, notification or production operation was performed.

## Reproduction before the repair

All **13 initial actual-hook regressions failed** against the preceding hook:

- Failed edits and deletes restored a whole old message array, losing messages received during the request. An older edit failure also undid a newer successful edit of the same row.
- A failed edit/delete in a retired A visit could restore that visit's history after A → B → A.
- An old successful send receipt could mark the new visit's pending row with the same client UUID as confirmed and remove its pending-map entry.
- A reaction read completed after leaving a room and still began a write. The shared reaction lock blocked a new visit, and its old finalizer could release later work. Reaction rollback replaced another member's newer reaction with its snapshot.
- The one-time `getUser` effect did not observe sign-out or account changes. Old profile/initial identity results remained eligible. Retained mutation callbacks performed transport after unmount.

An additional preservation test exposed a fast-receipt boundary: the receipt removed its pending map entry before React ran the optimistic updater, so the confirmed message never appeared. The updater now captures the pending rows when enqueued and the confirmation still targets the exact original UUID.

A bounded reaction follow-on added four regressions, with **three failing before its repair**. A successful update disappeared when the server had the viewer's reaction row but the local snapshot lacked it; a successful insert showed the old reaction when the snapshot still contained a server-removed row. The optimistic updater also erased another member's reaction queued earlier in the same React batch. The unchanged toggle-off case already passed. The final implementation derives the confirmed viewer reaction directly from the existing server update/insert/delete branch and applies the optimistic change against updater-current reactions. It never rebuilds other members' reactions from an old snapshot. The original query filters, storage keys and toggle rule remain unchanged.

## Ownership and recovery

The hook reuses the existing, read-only `useObservedUser` observer. Its synchronous identity guard and account epoch join the existing topic visit generation. Alice → Bob → Alice retires the old visit even when the final account and topic IDs match; an auth event invalidates old callbacks before React commits a new render. No sign-in, sign-out, token refresh or global auth-query code changes.

Message reads and subscriptions now wait for an identified account. Sign-out retires the channel, clears messages, pending sends, reaction locks and paging state. The existing read-generation, request/cursor checks and realtime coalescing now also cover account transitions. Initial identity errors surface through `loadError`; the existing `refresh` action retries the observer. The existing public profile query is account-scoped and rejects retired completions; old names/photos are not reused during a new identity read.

Every mutation checks ownership before starting, after its asynchronous boundary, and before state application. Reaction reads check again before choosing a write. A stale send does not begin a receipt lookup after its insert settles; a request already sent may still have committed remotely. Pending maps and reaction locks belong to their visit, so old finalizers cannot modify a later visit's structures or invalidate its inbox state.

Edits roll back only the original body/edit timestamp while that attempted edit still owns those visible fields. Deletes restore only their missing original row, merged into the current list in the existing chronological order. Per-message attempt identity keeps an older edit/delete outcome from undoing a later local operation. Reactions apply/restore only this account's reaction while the optimistic reaction is still current, retaining other members' reactions and other message fields. These are local reconciliation guards, not a server versioning or transaction protocol.

The additive caller contract is:

```ts
import { isObsoleteTopicOperation } from '../hooks/useTopicChat';

// Captured before starting a screen operation, including upload/picker work.
const stillCurrent = chat.isCurrent;
try {
  await chat.sendMessage(body);
  if (!stillCurrent()) return;
  // Current-screen success cleanup only.
} catch (error) {
  if (!stillCurrent() || isObsoleteTopicOperation(error)) return;
  // Current-screen error feedback only.
} finally {
  if (stillCurrent()) {
    // Current-screen busy-state cleanup only.
  }
}
```

`ObsoleteTopicOperationError` and its predicate are named exports. Mutation return types remain `Promise<void>`. The error means the former UI no longer owns the result; it does not assert that the server rejected the action. A successful late response also rejects with this typed obsolete result so an old caller cannot mistake it for permission to clean up a newer draft.

## Caller boundary and limitations

The sole application consumer is `app/community-topic/[id].tsx`. At the start of this package, its `handleSend` cleared draft/edit/reply state, stopped typing, opened the local said-hi gate, scrolled, and cleared busy state after awaiting. Photo/location paths also cleared preview, upload and send-session state. Reaction/delete catches could show alerts from retired requests. Root is implementing the caller guards separately; this hook package alone is **not** end-to-end screen mutation recovery.

This repair does not cancel an in-flight database operation, change authorization/membership gates, serialize server writes across clients, or introduce a durable mutation queue. Existing same-message overlapping transports are not turned into a server-ordered edit transaction: attempt ownership prevents a prior outcome from overwriting the latest local attempt, while later server refresh remains authoritative. The newest-window history policy and source mutual-block checks remain as before. A blocked/removed sender or server-side deletion still depends on those existing reads and backend policies; no full-history synchronization is claimed.

## Local checks

`hooks/__tests__/useTopicChat.mutations.test.tsx` contains **27 actual-hook cases**. The real `useObservedUser` and receipt helper run against deferred mock identity/profile/message/reaction operations; no production service is called. Coverage includes room/account A → B → A, the synchronous auth-event gap, late success/error/unmount, locked reactions, narrow rollback, a newer successful edit, identity retry, exact send payload and receipt filters, the fast receipt boundary, and authoritative reaction outcomes that preserve other members' queued updates.

The existing 30-case refresh suite changes only its auth subscription mock and waiting for identified-account readiness before two initial-read scenarios. All original read, paging and burst-coalescing assertions remain.

```sh
./node_modules/.bin/jest --runInBand --ci --detectOpenHandles --cacheDirectory=/private/tmp/washedup-topic-mutations-agent-jest hooks/__tests__/useTopicChat.mutations.test.tsx hooks/__tests__/useTopicChat.refresh.test.tsx lib/__tests__/topicPendingMessages.test.ts lib/__tests__/topicSendReceipt.test.ts components/chat/__tests__/ChatUxContract.test.ts
```

Result: **5 suites, 69 tests passed**, exit 0; no open handles reported. The preceding mutation-only package passed 65 before the four reaction follow-on cases were added.

```sh
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-topic-mutations-agent.tsbuildinfo
```

Result: **exit 0**. Scoped `git diff --check` is clean. The existing dependency symlink was left intact for the parent task; no install, original dependency changes or device verification.

Owned files: `hooks/useTopicChat.ts`, new `hooks/__tests__/useTopicChat.mutations.test.tsx`, the narrow fixture updates in `hooks/__tests__/useTopicChat.refresh.test.tsx`, and this document. Existing unrelated changes and the previous read repair remain preserved.
