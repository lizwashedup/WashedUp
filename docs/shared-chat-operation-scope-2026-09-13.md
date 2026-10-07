# Shared Plan, Circle and DM transport ownership — 2026-09-13

Local implementation candidate in the isolated checkout. No backend requests, production sends, provider operations, installs, migrations or deployment were performed. `ChatThread.tsx`, audio upload and location-entry integration are separate coordinated packages; this document covers the active `useChat` transport.

## Source finding and reproduced failures

`components/chat/ChatThread.tsx` uses `hooks/useChat.ts` for both Plan (`event`) and Circle conversations. The two-person DM uses the Circle-backed path. The alternative `hooks/useChatEngine.ts` has no source consumer; `hooks/__tests__/useChatEngine.deadPath.test.ts` verifies that boundary. It remains unchanged, including its weaker cancellation/account handling.

Before this patch, `useChat` captured the room in send callbacks but obtained the account from a mutable `currentUserIdRef`. That ref was updated by a message fetch rather than an auth subscription. A retained callback could combine an old room with a newer user. Existing room-generation and newest-request guards covered primary history, pagination and realtime sender enrichment, but did not include an account epoch or cover mutation/receipt continuations.

The new actual-hook test initially failed all nine reproduction cases:

- A retained send still inserted after room A → B → A, account A → B → A, sign-out or unmount.
- A retired text/photo, location or audio insert still began its receipt lookup.
- An authoritative reaction lookup still began its following write after an account transition.
- A failed delete restored the whole old message list and removed an incoming message received meanwhile.

## Implemented contract

`hooks/useChat.ts` exports `ChatOperationScope`, `ObsoleteChatOperationError` and `isObsoleteChatOperation`. It returns `operationScope: ChatOperationScope | null` with a stable `{ userId, isCurrent }` identity per committed room, observed account and account epoch. `useObservedUser` is reused without changing authentication flow. Its synchronous identity check also retires old callbacks before the next React render. An empty route or unresolved/signed-out account has no usable scope.

The original methods remain callable without an extra scope. Each captures its own hook scope; a supplied scope further restricts the same initiating account and can retire the composer entry when its gate closes:

```ts
sendMessage(content, imageUrl?, replyToId?, sendIdOverride?, scope?)
sendLocation(lat, lng, address, scope?)
sendAudio(audioUrl, durationSeconds, scope?, sendIdOverride?)
editMessage(messageId, newContent, scope?)
deleteMessage(messageId, scope?)
toggleReaction(messageId, reaction?, scope?)
```

Retired mutations consistently reject `ObsoleteChatOperationError`. Callers should suppress their obsolete UI completion and must not clear a newer draft or show an old alert. Current text, location and edit boolean results are preserved. Audio now also returns `true` only after a matching receipt, and `false` for current unconfirmed/no-account outcomes, so the caller can retain a retryable recording. Its optional fourth argument lets an explicit retry reuse the same message UUID. Existing callers that ignore its return remain compatible.

The message transport still writes the same `messages` fields, original event/Circle parent column, initiating sender and client UUID. Receipt lookup still filters UUID + exact room parent + initiating sender. Scoped callbacks check before and after internal requests; a retired insert cannot begin a later lookup, even though the shared receipt resolver catches transport errors. No reaction policy, RPC, schema, recipient, membership or delivery rule changes were made.

Optimistic send cleanup for entry-only retirement removes the exact object created by that attempt. It preserves another attempt using the same UUID and any already-confirmed realtime row. Current failed edits/deletes restore only their owned target change; they do not replace the entire list or overwrite a later edit. Reaction rollback changes only the initiating user's reaction and retains newer other-member reactions. Visit-owned lock sets prevent old finalizers from releasing a newer visit's lock.

## Reads and account privacy

Newest reads, older reads, realtime callbacks, sender hydration, block preferences, read markers and notification cleanup now inherit the observed account/epoch as well as room lifetime. Returned messages are hidden during a room/account transition and until this account's initial block-preference read is known. Realtime activity received during that initial read is retained for reconciliation; allowed activity survives and blocked activity never appears.

Initial identity failure is an honest, retryable loading error. It starts no unowned conversation read or subscription. The existing auth-lock session fallback is retained after identity is established, but it may only confirm the captured account. A missing/different user cannot adopt a new sender or read-marker identity; a refresh failure keeps already-owned history. An errored private block-preference read cannot be treated as an empty block list.

The existing `['profile-blocked', userId]` cache and invalidation contract remains. If a current room joined a cached in-flight request whose previous owner retired, it retries that privacy read once under its own scope. This avoids making ordinary room return fail solely because a shared request belonged to the room just left.

## Validation

Seven targeted suites pass: **64 tests**, including **34 new actual-hook ownership cases**, the existing 19-case refresh/lifetime suite, paging, inactive-engine, photo/text UUID sessions and receipt compatibility.

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-chat-ownership-agent-jest hooks/__tests__/useChat.ownership.test.tsx hooks/__tests__/useChat.refresh.test.tsx hooks/__tests__/useChatEngine.deadPath.test.ts hooks/__tests__/chatPaging.test.ts lib/__tests__/photoSendSession.test.ts lib/__tests__/textSendSession.test.ts lib/__tests__/topicSendReceipt.test.ts
```

The existing refresh suite only gained an auth-subscription mock; its history/cursor/realtime assertions remain. The new cases cover account and room ABA, synchronous sign-out, unmount, stale authentication/fallback, read-marker sequencing, privacy-read errors and sharing, hidden initial realtime, stricter entry scopes, exact optimistic cleanup, narrowed rollback, reaction lock ownership and stable audio retry receipts for event and Circle parents. All test transport is mocked synthetic data.

An earlier broad run also found the separate `ChatUxContract` exact reply-focus source string had become obsolete during the coordinated `ChatThread` guard change; that test belongs to the entry package. Final full TypeScript check passes with `./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-chat-ownership-agent.tsbuildinfo`; scoped `git diff --check` is clean. Dependency reuse uses the already-existing root-owned symlink and `/private/tmp` caches; it is left for root cleanup.

## Limits

Client scope guards do not cancel a request already dispatched, atomically bind a refreshed network token to a captured user, replace RLS or reverse a remote write. A stale completion can therefore represent an unknown server result. There is no automatic send retry. Preserving a draft/voice file and checking the original room before a retry remains the entry component's responsibility.

This hook does not itself own device permission dialogs, media preparation, storage uploads, recording callbacks, location selection, navigation, or composer admission state. Callers must capture/pass the entry scope and guard those awaits separately. Existing read-marker timing and notification delivery semantics are not redesigned here. No device, end-to-end production or push-delivery claims follow from these mocked checks.
