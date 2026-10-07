# Topic/event chat entry ownership

This isolated repair completes the screen side of [topic mutation ownership](./topic-chat-mutations-2026-09-13.md). No production release, database operation, provider change or real message was performed.

## Reproduction and change

Five actual-screen cases failed before the fix: success cleared a newer draft, an old room's send retained/released the wrong busy state, an account switch kept the old draft and error, delayed photo permission opened a picker after navigation, and photo preparation continued into upload/send after leaving.

The screen now gives drafts, reply/edit context, welcome entry, pickers, send sessions and local said-hi feedback one room/account visit. Old successes, failures, modal/native callbacks and finalizers cannot update the new visit. The hook's synchronous identity guard also covers the gap between an auth event and rerender.

A draft revision keeps text or a mention written during an earlier send. Synchronous attempt ownership prevents repeated retained send/photo/picker callbacks from launching overlapping work before a render updates button state. Exact-attempt finalizers cannot release newer busy state. UUID receipt and explicit retry behavior remain intact.

Attachment access has its own committed lifetime. Removal, banning, expiry/archive, the first-message gate, an unresolved introduction check or starting an edit closes attachment entry. Permission/preparation/upload results from the retired access lifetime cannot continue, including close → reopen transitions in the same room. An upload or database request already sent cannot be cancelled by these UI guards; the server remains responsible for authorization.

The introduction rule remains: the first confirmed text may open the event chat. A photo/location never substitutes for it. Existing joins, moderation, expiry calculations and notification recipient rules are unchanged.

## Verification

`components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx` passes **27 actual-screen cases** with deferred mock transport and no production calls. Coverage includes navigation/account return, old success/error, newer drafts and mention edits, duplicate callbacks, photo permission/preparation/upload, attachment gate closure/reopening and first-text gate continuity.

The final combined run passes **156 tests across 15 suites** with `--detectOpenHandles`: topic mutation/refresh, pending/receipt contracts, actual-screen entry, photo selection/viewing/layout, shared composer, main/topic/Plan headers, notification controls and the existing chat UI contract. Full `tsc --noEmit` passes. These are local engineering checks, not evidence of physical-device keyboard, reconnect, smooth scrolling or actual OneSignal delivery.

Next: verify physical-device behavior across the room/account/attachment cases; continue the remaining main-stream and Plan/Circle/DM entry adapters. Broader account-scoping of older React Query caches, durable outbox and server ordering remain separate work. Preserve the legacy mixed broadcast/intro history until the explicit room migration is rehearsed.
