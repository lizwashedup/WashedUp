# Individual profile: staged appearance and current-operation ownership

This package is local to the isolated native checkout. It ports `/profile/:id`, the individual profile, to the optional cream/Mona/clay presentation used by People. It is distinct from `/person/:id`, which remains the shared relationship/history page. No database, provider, deployment or live account action was performed.

## Preserved source contract

`hooks/usePersonProfile.ts` still calls `get_person_profile` with only `{p_target: targetId}`. The saved SQL in `supabase/migrations/20260629000100_extend_get_person_profile_trust_signals.sql` returns null for blocked/non-mutual targets and when the profile is absent. Those cases use the same unavailable screen; the UI does not reveal why. Existing server filters retain viewer-visible plan history and mutual faces, including Circle visibility and blocking. This is a saved source contract, not a newly verified production database result.

The page retains first name, existing handle, neighborhood, biography, vibe tags, permitted mutual faces/count, joined date, actual plans-created and phone-verification fields, upcoming/past history, and the original anti-zero count behavior. It does not infer attendance together or create new profile fields. History order remains the RPC order. Name and handle use two readable lines; an existing leading `@` is normalized, and missing handles are omitted. Failed portraits fall back to the person's initial, including when a signed URL changes after a failure.

Original actions remain:

- Message: `get_or_create_dm({p_other})`, then `/(tabs)/chats/circle/:id` after a confirmed nonempty ID.
- Make a plan: the existing `buildComposerWithPerson` link, with that person attached as the removable invited person.
- Your shared plans: `/person/:id`.
- Individual history row: `/plan/:event_id`.
- Remove: the existing remove confirmation and connection mutation.
- Staged Block (legacy Report or block): the existing shared block confirmation and its original report/block semantics; no separate reporting flow is invented.

The optional presentation uses the existing Afterglow tokens, full-color portrait, compact actions with at least 44-point controls, small corners, a readable left-aligned identity and history rows. Long names/history text can wrap. Staged labels are “Your shared plans” and “Past plans.” The removal confirmation also receives the optional Afterglow appearance through BrandedAlert: cream/Mona tokens, 4-point corners and at least 44-point action targets. Its button order, action-before-close timing and selectable scrolling behavior are unchanged. Legacy appearance/copy stays available when no appearance is supplied. The route uses the existing `COMMUNITY_CHAT_GROUPING_ENABLED` development gate and retains the Yours-disabled redirect. No bottom-navigation styling changed.

## Loading and ownership

The route uses observed account state instead of displaying a spinner indefinitely when no cached account exists. Loading, retryable account/profile failure, and quiet unavailable are distinct, with Back still reachable in the safe area. Cached profile facts are not displayed during an error or account mismatch. A response for the wrong target is rejected rather than rendered.

The optional profile read scope is `{userId, epoch, isCurrent}`. The existing cache prefix is preserved and the account epoch appended for scoped callers. `getUser` verifies the actual account before the RPC; the read consumes its abort signal and rechecks scope after awaits. Legacy callers without scope retain their prior key and do not receive the added auth preflight. Account A → B → A uses a new cache generation.

The component keeps a distinct account/target lifetime and a focus visit. Leaving and returning does not remount the ScrollView, while old action callbacks, photo errors, menu closure callbacks and mutation completions cannot act on the return visit. Retained plan-row callbacks validate that the plan is still in the latest permitted payload. Menu actions wait for the real `MenuCard.onClosed` callback before opening a confirmation; the former fixed delay is gone.

Message carries the newly optional `useGetOrCreateDm` per-call scope `{userId,isCurrent}`. It is copied before React Query scheduling and checked before/after awaits, before RPC dispatch, inbox invalidation, callbacks and async return. A blur during preflight prevents the dispatch. Existing unscoped DM callers retain account/mount ownership and their scalar API. Different current scopes remain independent.

Remove uses the existing connection mutation's `{userId,isCurrent,canDispatch}` scope, and block uses the shared block hook's account/visit scope. Immediate local locks prevent double actions. Confirmed removal/block can navigate after their own cache refresh makes the profile unavailable, but not after a target/account/visit change. A current failure remains visible and retryable.

## Verification and remaining boundaries

Focused tests exercise the actual profile/route and real query/mutation hooks against controlled service boundaries: preserved fields/routes, appearance fallback, handles, portrait renewal, privacy nulls, read errors/retry, immediate locks, deferred auth/RPC/confirmation outcomes, scope dispatch, account round trips, focus return, unmount and callback retirement. The companion browser fixture is reviewed separately by the main task; it is not a real-device or production-backend test.

Final local validation: **144 tests passed across 6 suites**; full TypeScript and the scoped whitespace diff check passed.

Commands:

```
node_modules/.bin/jest --runInBand --ci app/__tests__/individualProfileRoute.test.tsx components/yours/profile/__tests__/PersonProfilePage.test.tsx hooks/__tests__/usePersonProfile.scope.test.tsx hooks/__tests__/useBlock.scope.test.tsx hooks/__tests__/useGetOrCreateDm.lifetime.test.tsx hooks/__tests__/usePeopleConnectionMutations.scope.test.tsx
node_modules/.bin/tsc --noEmit --pretty false
```

Caller scope does not cancel or undo a server RPC already dispatched. The saved server mutual/block rules remain authoritative. Native device navigation, text scaling, the real menu/confirmation transition, and production account/backend behavior still require the staged integration/device checks. Own-profile settings and the remaining main composer are separate packages.

Final visual-polish follow-up: **34 tests passed across the BrandedAlert and individual-profile suites**, full TypeScript and scoped diff checks passed. BrandedAlert retains its default style for all callers without the new optional appearance.

Root integrated validation: **150 tests in 7 suites pass**, including the new alert appearance. Actual-component browser checks cover 320/375/430px; see Design/Shared Experience - Round 1/verification/individual-profile/VERIFICATION.md.
