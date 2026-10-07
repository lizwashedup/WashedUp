# Shared chat presence and typing ownership — 2026-09-13

Isolated local candidate. This package changes `hooks/useTypingIndicator.ts` and adds `hooks/useActiveChatPresence.ts`, their focused tests and these notes. Root owns the `ChatThread.tsx` integration. No live API, notification, database, schema, provider or deployment operations were performed.

## APIs and preserved behavior

```ts
useActiveChatPresence(id, operationScope, !!props.enablePresence)
useTypingIndicator(id, currentUserId, currentUserName, props.kind, operationScope)
```

Both accept the readable room/account `operationScope` from `useChat`. Presence deliberately does not use the writable composer guard: an expired Plan can still be viewed. The existing Plan wrapper opts into `active_chat_event_id`; Circle and DM wrappers continue to leave that behavior disabled. The presence hook owns focus and AppState handling internally.

Typing's fifth scope argument is optional, so existing four-argument topic and other callers remain valid. Explicit `null` holds subscription/traffic while identity is unknown. Supplied scopes require the matching account and stay retired across repeated room/account IDs. Unscoped callers retain their previous identity inputs; they do not acquire the stronger external account-epoch signal automatically.

Channel names remain `typing:<id>`, `typing:circle:<id>` and `typing:community-topic:<id>`. Payloads remain `{ userId, name, isTyping }`; outgoing throttle is 3 seconds, idle stop 5 seconds, peer expiry 6 seconds and pruning 1 second. No typing data is persisted and no new membership/recipient policy is introduced.

## Source failures and repairs

The old typing effect cleared `peersRef` on cleanup but left its rendered `typingUsers` array unchanged. A new quiet room could show the previous room's name indefinitely: its new empty peer map had nothing to prune. Old broadcast, subscription and send closures also used current shared refs, letting a retired sender address the next room/channel with an old account payload.

Typing state now carries its owning visit, clears on transition and is hidden when stale. Every receive, status, prune, outgoing callback and idle timer checks its visit/supplied scope. Retained callbacks cannot mutate the next visit's refs. Five actual-hook lifetime reproductions failed before the change; the three original namespace/payload/timing checks passed.

The original inline Plan presence effect was extracted into the new hook unchanged for reproduction, before adding guards. Eight of ten focused cases failed: a set resolving after blur was never cleared, delayed old-room operations could overtake a newer room, auth reads could adopt another account, backgrounding during auth still allowed activation, clear lacked a room comparison, and an unknown activation result was never considered for cleanup.

Presence now captures the initiating user and room. Private per-account promise queues serialize this JS client's existing profile writes across mounted navigation screens. Each intent is reevaluated after authentication; activation requires current focus, active AppState and readable scope. Cleanup authenticates the captured account, writes only its profile and compares `active_chat_event_id` to the captured room, so it cannot blindly erase a different active room.

A dispatched activation remains eligible for cleanup even if its result is unknown. Cleanup errors remain eligible for another lifecycle attempt. A newer active visit to the same Plan inherits cleanup responsibility from the old visit; a conditional room-ID comparison alone cannot distinguish those two visits. A dedicated regression reproduced the case where replacement activation failed and otherwise stranded the inherited presence.

No schema or server notification behavior changes: this still only maintains the existing `profiles.active_chat_event_id`. The saved `20260906150000_push_notification_retry_age_cutoff.sql` claim function marks unread `new_message` pushes suppressed when their event matches this profile field. The client repair reduces stale field writes; it does not reverse previously suppressed notifications or change delivery semantics.

## Checks

**82 tests pass across four suites**: 18 new presence cases, 11 new typing cases, 34 transport ownership cases and the existing 19 refresh/lifetime cases.

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-chat-presence-agent-jest hooks/__tests__/useActiveChatPresence.test.tsx hooks/__tests__/useTypingIndicator.lifetime.test.tsx hooks/__tests__/useChat.ownership.test.tsx hooks/__tests__/useChat.refresh.test.tsx
```

Tests use mocked auth, profile writes, AppState, focus, broadcast channels and synthetic accounts. Coverage includes room/account ABA, same-ID epochs, initial unknown scope, mismatched auth, background/foreground races, old callbacks after unmount, multiple mounted screens, unknown set/clear outcomes, cleanup transfer and unchanged typing payload/timing. Full TypeScript passes with `./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-chat-presence-agent.tsbuildinfo`; scoped `git diff --check` is clean.

## Boundaries and remaining source audit

These queues only order this JS client. They cannot coordinate another device, another process, a server write or a network request whose response completed before its delayed remote commit. Conditional cleanup protects a different room ID; the database has no per-client or per-visit lease to distinguish simultaneous clients in the same room. No lease/schema feature is invented here.

Cleanup after sign-out may be unable to clear the previous account's row using its now-unavailable session. Captured-user comparison prevents adopting the next account; it does not recover authorization for the previous one. A crash or permanently failed final cleanup can still leave server presence stale. Native focus/AppState timing, connectivity and actual push behavior require device/server verification. Already-dispatched requests remain subject to RLS and cannot be atomically rebound or canceled by this hook.

The bounded source audit also identified separate moderation work, intentionally not implemented in these hooks:

- `ChatThread` report-member awaits and delayed native/custom action-sheet callbacks need readable entry ownership checks. All its `blockUser` calls can use the already-supported fourth `BlockOperationScope` argument, including success navigation. That existing scoped hook also preserves error handling and pending-tap protection.
- `ReportModal` itself awaits `getUser` before inserting `reports`, with no initiating-account scope. Guarding only the parent menu cannot protect a report already submitted when the account changes. Its delayed success/error UI and state-only duplicate-submit lock also need their own attempt lifetime.
- Reporting/blocking are currently available while a Plan is read-only; preserve that policy with a readable-entry guard. Quick/full reactions are currently restricted by the writable presentation gate, but delayed reaction callbacks should also pass the writable scope and handle obsolete promise rejection. Own-message deletion remains independently available; do not infer a new expiry restriction.
- The measured Circle/DM `+` callback and the parent's delayed `MenuCard.onClosed` actions retain room/person context across a navigation or account change. A child measurement guard alone does not retire an already-open parent menu; the parent needs its own context scope if repaired later.

No changes were made to those moderation components, parent routes, global auth hooks or screen files in this package.
