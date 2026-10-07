# Community replies and reaction controls: operation lifetime

This isolated source change closes the nested-component gaps identified in `main-community-lifetime-audit-2026-09-13.md`. It changes `components/communities/CommunityMessageActions.tsx` and `components/communities/BroadcastCard.tsx`; it does not publish an app, change data or alter a schema.

## Reproduction evidence

The actual components were mounted with a real React Query `QueryClientProvider`; only the community transport and device-only dependencies were replaced by controlled local mocks. The initial twenty test cases produced **18 failures and 2 passes before the fix**. Both views reproduced newer-draft erasure, two sends from one retained double-tap callback, old-account errors reaching the current view, concurrent reaction operations, previous-account replies appearing through the shared cache, stale A → B → A reply reads, and retained controls targeting a reused message component. The two existing successes verified preservation of failed reply text for retry.

After the repair, the original twenty and thirteen additional cases pass: **33 tests** in `components/communities/__tests__/CommunityCompanionLifetime.test.tsx`. The additional checks cover transport scope propagation and retirement, explicit reply-read retry, unmount suppression, collapsed-thread preservation, original reaction policies/table keys, delegated page reaction locking, original intro payload/text and queued picker callbacks.

Command:

```sh
npm test -- --runInBand --cacheDirectory=/private/tmp/washedup-companion-jest components/communities/__tests__/CommunityCompanionLifetime.test.tsx
```

Pre-fix output: `/private/tmp/washedup-companion-before.log`.
Post-fix output: `/private/tmp/washedup-companion-after.log`.

## Resulting behavior

- Both components accept an optional stable `scope: CommunityOperationScope`. The main screen supplies the initiating viewer and admission visit; the nested component adds its own message/component lifetime. Reads, replies and reactions pass this combined scope into the additive transport contract.
- Scoped reply cache keys include message ID, viewer ID and a unique component visit. A new account or a return to the same account receives a distinct key. Retired reads are rejected after awaits, and their exact scoped queries are canceled during cleanup. Existing unscoped callers keep their original key and service behavior.
- Reply and reaction attempts acquire synchronous ref-owned locks. Late completions cannot release a newer attempt's lock. A successful reply clears only the draft revision that was submitted, preserves text typed afterward and respects the user's decision to collapse the thread.
- Queued input, reply toggles, retry controls and reaction picker callbacks check their originating visit. An obsolete error does not raise a current-room alert or success haptic.
- The main message's quick reactions can use the optional `onReact` coordinator. The main screen supplies its existing per-message handler so quick chips and the full emoji picker share a lock. Legacy direct callers retain the original single-selection replacement policy. Broadcast/intro cards retain their existing independent per-emoji toggle policy.
- Failed reply history has a visible “Replies couldn’t load. Tap to retry.” action instead of appearing to be an empty thread.

The shared interaction hook lives in `CommunityMessageActions.tsx` and is reused by `BroadcastCard.tsx`, so the same operation rules apply to both representations of the existing broadcast reply/reaction tables.

## Preserved and unproven boundaries

Original message and reply IDs, message body, intro kind/payload, `composeIntroCard` inputs, attribution, reply ordering and reaction keys remain intact. No community joining rule, creator approval, existing first-message gate, moderation destination, location/photo format or notification provider changes are included. No topic screen or shared chat transport was edited by this companion package.

These component tests establish the local UI lifetime and cache behavior. Separate transport tests cover the internal auth await and subsequent request boundaries. The component tests do not establish real-device/network delivery, production authorization, notification delivery or broader design approval. Replies retain the existing transport protocol; this package does not introduce a new idempotent reply receipt protocol for an unknown server result.

The existing `node_modules` symlink was left intact and read-only. Jest caches and logs stayed under `/private/tmp`. A full repository typecheck at the end of the companion work reported only the concurrently edited `hooks/useBlock.ts` shadowed-`current` errors; the coordinating screen agent was notified and owns the final integrated typecheck after its edit settles.

## Final integration result

After all companion and screen edits were frozen, the coordinated main-community package passed 130 tests in 11 suites. The root full-repository noEmit TypeScript check and scoped diff check also passed. Earlier references to in-flight missing props or shadowed names above are historical check results, not remaining compile errors. Physical-device and production boundaries remain unchanged.
