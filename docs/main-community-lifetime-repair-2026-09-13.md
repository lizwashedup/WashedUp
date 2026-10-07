# Main community conversation · lifetime repair

This isolated implementation addresses the screen-owned issues in `main-community-lifetime-audit-2026-09-13.md`. It changes local ownership of requests, drafts and controls; it does not change the community stream, its admission rules, provider or production records.

## Screen changes

- Message pages, membership, cards, members, pinned-event and empty-thread gate queries now include the observed viewer and auth epoch. The header-card query also includes the room because its read belongs to a room visit; a real QueryClient regression test reproduced a stuck generic header when that room dimension was missing. Queries wait for known identity. Their functions check the original visit and React Query abort signal before and after each read; cleanup cancels only that visit's exact query keys. The existing full QueryClient remains in use.
- An entry visit is keyed to community ID, viewer ID and auth epoch. Changing visits clears entry drafts, edit state, picker selections, menus and retry sessions once. Old callbacks cannot act during the observer's synchronous pre-render identity change. Gallery selection and scheduled scroll work also belong to the visit.
- A draft revision records input, mentions, edit selection and cancellation. Confirmed text, edit and photo sends clear only the revision they submitted. Newer unsent text survives. Failed unchanged text retains its retry UUID; a confirmed message retires that UUID.
- Text sends, photo permission/picker work, photo upload/send, location shares, message deletion and reactions use synchronous ref-owned attempts. Only their original current attempt can release its lock or publish feedback. Quick reactions and the full reaction picker share the screen's per-message reaction serialization through the companion's `onReact` prop.
- A separate admission visit retires callbacks on confirmed removed/banned membership. An attachment visit also retires work when editing begins. Permission, picker, preparation and upload results are checked before advancing. A removed → active transition creates a new allowed visit and does not revive the old one. Pending overlays are closed; old cancel/menu/input callbacks do not affect new state.
- Read-marker and realtime work now capture the active account/visit, including a local effect-active guard. A stale subscription cannot mark an old room read for the next account. Subscription names include viewer/epoch, and cleanup retires callbacks before unsubscribe.

The additive transport contract is `CommunityOperationScope { userId, isCurrent }` from `lib/communityChat.ts`; helpers use it to close the internal auth-await and receipt-lookup gaps. `CommunityMessageActions` and `BroadcastCard` receive the same optional scope; the companion component repair owns their embedded replies/reaction controls. Their actual-component tests are included in the integrated result below.

## Preserved behavior

The existing community IDs, `community_broadcasts` rows, message/intro `kind` and `payload`, chronological paging, membership statuses, system intro content, photo/location formats and send-receipt filters are unchanged. There is no new main-room say-hi gate. A failed or unknown membership read continues to defer to the existing server permission checks. Confirmed removal still shows the same permission state; this repair does not claim to redesign historical-message visibility after removal.

Header and pinned-event destinations, original room names, mute controller, message actions, development flag and flag-off presentation remain. An already-submitted server operation cannot be unsent by retiring its UI visit: its late completion simply loses ownership of the next visit's draft, feedback and locks. No live server result or physical-device behavior is asserted by the local tests.

## Tests

`CommunityMainEntryLifetime.test.tsx` exercises the actual screen with deferred transport/native-picker mocks. The initial run reproduced stale draft/room/account behavior, duplicate pipelines, stale attachment work and room-only read-marker ownership; implementation then made the cases pass. The suite includes unchanged retry UUID preservation and unknown-membership behavior.

`CommunityMainQueryIsolation.test.tsx` uses a **real QueryClientProvider**, not a mocked query hook. It verifies that account A's messages and own-reaction flags are absent while account B loads, delayed A reads cannot populate a later A visit, unresolved identity starts neither data nor read-marker operations, and switching rooms during a pending header-card read starts the next room’s read correctly.

Existing `CommunityMainHeader.test.tsx` and `CommunityChatPhotos.test.tsx` were updated only to supply the full observed-account/query-client test contracts. They continue checking original IDs, intro payloads, photo order/actions, named room navigation, offline draft, removal and flag-off appearance. Main implementation does not edit the topic screen.

The optional fourth `blockUser` argument is a structural `BlockOperationScope { userId, isCurrent }`. The main screen passes its operation scope. Native confirmation callbacks check the initiating visit before reading auth, verify the returned user ID, and recheck after profile reads and writes. Scoped duplicate confirmations share a ref lock; an old completion cannot release a newer account’s attempt. Retired operations cannot post the follow-up report, invalidate caches, close a new screen, or display delayed success/error feedback. Existing unscoped callers retain their calling convention and behavior. A block update already dispatched before retirement cannot be cancelled or rolled back by the UI; tests assert suppression of later work, not cancellation of the write.

`hooks/__tests__/useBlock.scope.test.tsx` reproduced seven failures among its original eight cases before the hook repair. The final twelve cases include deferred auth/profile/write operations, exact initiating-user enforcement, success/report payload preservation, original unscoped completion, resolved read/write errors, synchronous duplicate confirmation, late finalizer ownership and unmount.

Final integrated validation: **130 tests pass in 11 suites**, comprising 40 main-screen tests, 33 companion tests, 45 transport/preservation tests and 12 scoped Block tests. Command (run from the isolated checkout):

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-main-entry-jest \
  components/chat/__tests__/CommunityMainEntryLifetime.test.tsx \
  components/chat/__tests__/CommunityMainQueryIsolation.test.tsx \
  components/chat/__tests__/CommunityMainHeader.test.tsx \
  components/chat/__tests__/CommunityChatPhotos.test.tsx \
  components/communities/__tests__/CommunityCompanionLifetime.test.tsx \
  hooks/__tests__/useBlock.scope.test.tsx \
  lib/__tests__/communityOperationScope.test.ts \
  lib/__tests__/topicSendReceipt.test.ts \
  lib/__tests__/communityMutePreference.test.ts \
  lib/__tests__/communityBlocks.test.ts \
  lib/__tests__/communityChatUi.test.ts
```

Full TypeScript validation is coordinated by the parent after all parallel implementation packages freeze; this document does not imply that the independently edited mobile package has passed it. Device backgrounding, native permissions/UI, realtime delivery and server permission enforcement still require the existing isolated device verification process; no install, dependency change, migration or production request was performed here.

## Root integration check

All contributing source files were frozen before the final full-repository `tsc --noEmit --pretty false` run. It passed, as did the scoped diff check. The local component-review bundle was rebuilt successfully after the composer simplification. Combined main-community tests passed 130/130, the separate composer/media package passed 55/55, and PlanCard passed 9/9. Those are bounded local verification packages, not end-to-end production or native-device approval.
