# Circle plan creation lifetime — September 13, 2026

Local isolated implementation only. No production, provider, schema, account, or real-message operation was performed.

## Reproduced behavior

Actual `CirclePlanComposer` callbacks could post twice before React rendered the pending state. A pending save could later close the sheet, erase a replacement draft, or navigate after dismissal, reopening, account change, or circle change. Recipient choices could change while the old save waited. Directly retained submit callbacks also bypassed the UI-only subset and open-description disabled gates.

The actual `useCreateCirclePlan` hook had no initiating-account check. Its RPC received the caller's mutable recipient array and completed with cache invalidations even after the initiating entry retired.

The final two suites against frozen pre-change source reproduce **23 failures / 5 positive cases**, 28 total. The transformer substitutes only these two saved source files while retaining their original paths/import resolution; it never overwrites the working source. Evidence is in `/private/tmp/washedup-plan-baseline-final.log`.

## Repair

- The composer observes account identity and its auth epoch. Draft content belongs to one visible visit, circle, account, and DM classification. Closing, reopening, changing that context, or a supplied parent admission scope retires old controls and callbacks.
- `scope?: CirclePlanOperationScope | null` is additive. Omitted callers remain supported; null blocks writes. The repaired Circle chat parent supplies a stable admission scope, so metadata refresh alone does not reset a draft.
- A synchronous local attempt lock protects the submit action. The transport also rejects overlapping current attempts. It snapshots all arguments, recipient IDs, and initiating identity before React Query schedules the mutation function.
- Authentication is checked before the RPC. Auth transitions, scope retirement, and unmount are checked after awaited work and before cache invalidation. Late success/error never changes a later entry's UI. Non-idempotent automatic retries are disabled.
- Existing title, future date, open-description, and subset gates are enforced in the submit handler as well as its disabled state.
- A current success with the unchanged draft preserves the original `onClose` → `onPosted` order, including a synchronous parent render hiding the sheet. An account change caused by that close prevents subsequent navigation. Changes typed during a pending save remain visible with confirmation that the earlier plan was posted.
- Dismissal is separate from write authorization: the current sheet can be closed while account information is unavailable. Old dismiss callbacks cannot close a later visit.

## Preserved behavior

No restyling or new plan feature. Whole-circle Just us plans still have no separate chat; selected-member plans keep their chosen IDs and own-chat behavior; open plans still go to the feed with their own chat. DM composition still omits subset selection. LA wall-clock conversion, original category/location/description payloads, mixed default gender rule, 2–7 stranger cap/default 4, RPC name and parameter names, cache invalidation prefixes, and `event_id`/`has_own_chat` results remain unchanged. This surface did not supply fee parameters and still does not. Server membership/permission rules remain authoritative.

## Verification

- `components/circles/plan/__tests__/CirclePlanComposerLifetime.test.tsx`: **17 passed**, actual component with controlled child controls and deferred mutation responses.
- `hooks/__tests__/useCreateCirclePlanLifetime.test.tsx`: **11 passed**, actual hook and real QueryClient with controlled auth/RPC responses.
- **28/28 passed** against the repaired source; `/private/tmp/washedup-plan-after.log`.
- Full `tsc --noEmit --pretty false` passed; `/private/tmp/washedup-plan-tsc.log`.
- `git diff --check` passed for the two source files. Existing read-only `node_modules` symlink is intact. Test caches and baseline copies live under `/private/tmp`.

Positive coverage includes normal close-before-navigation, close that synchronously hides the sheet, current error/retry, selected recipients, valid open plans, DM whole-circle behavior, and dismissal during unavailable authentication. Deferred coverage includes room changes, account A→B→A before rerender, close/reopen, unmount, old place callbacks, current-draft edits, duplicate taps, and late RPC/auth outcomes.

## Boundaries

An RPC already dispatched may still complete server-side. The client cannot cancel or undo it, and this package does not add server idempotency or receipt reconciliation. The receipt-recovery continuation below replaces the original uncertain-network retry behavior. Tests prove client lifetime ownership and preservation, not device/network delivery or server correctness.

The separate Circle detail parent's admission-scope gap was completed in the bounded continuation below. Both it and `app/(tabs)/chats/circle/[id].tsx` now supply the child scope. Broader page-management, payment, and chat feature work is outside this package.


## Addendum — Circle detail parent

`app/circle/[id].tsx` now uses the identity already returned by `useCircle` (`viewerId`, `viewerEpoch`, `isCurrentViewer`), removing this caller's dependency on the legacy cached account hook. Both AddPeopleSheet and CirclePlanComposer receive the same stable readable operation scope. Account, circle, access-error transitions, and unmount retire the old entry; successful metadata refresh preserves the entry, scope object, child keys, and open forms.

Retained sheet-close, posted-plan, chat navigation, back, retry, naming, and leave-confirmation callbacks check their initiating entry. The existing naming gate is checked against the current role, including for a callback retained before an admin role is removed. Naming and other sheets close on entry retirement. Back and error retry remain usable without a readable Circle payload.

The normal successful composer close → posted navigation order remains intact. Current leave confirmation can close before dispatching its selected action, preserves the existing dismiss-all route on success and error alert on failure, and uses a synchronous parent attempt lock. An old account's pending hook state cannot disable leaving from the new entry, nor can its late result clear that new attempt or navigate/show its error there.

Verification:

- Actual `components/circles/__tests__/CircleDetailLifetime.test.tsx`: **17/17 passed**.
- Same suite with frozen original parent source: **15 failures / 2 positive cases**, `/private/tmp/washedup-detail-baseline-final.log`.
- Parent + composer + creation-hook suites: **45/45 passed**, `/private/tmp/washedup-detail-combined.log`.
- Full TypeScript check and diff whitespace check passed; `/private/tmp/washedup-detail-tsc.log`.

This continuation changed only the detail parent, its new screen test, and this addendum. No styles, routes, IDs, membership selection rules, backend writes, installations, or production actions changed. `NameCircleSheet` and `useLeaveCircle` internals were not rewritten: their underlying pending server mutations and hook-owned cache side effects remain outside this caller-scoping package. A dispatched server mutation cannot be canceled by retiring its screen callbacks.


## Addendum — Circle plan receipt recovery

The saved `create_circle_plan` SQL in `supabase/migrations/20260824180000_fix_dm_circle_plan_stranger_cap.sql` returns `jsonb_build_object('event_id', v_event_id, 'has_own_chat', v_has_own_chat)` at line 161. The ID is a UUID; the flag is a boolean determined by the server's whole-circle/subset/open rules. Each call inserts a new event (lines 110–126); the saved contract contains no idempotency key. This is source evidence, not a fresh production-schema verification.

The hook previously cast every non-error payload to that receipt, including null or a missing ID/flag, and invalidated caches before the caller could distinguish it. All current failures also cleared the posting lock, allowing another create after an ambiguous response. A committed write followed by response loss could therefore be duplicated.

`useCreateCirclePlan` now validates an object containing an exact UUID-shaped `event_id` and strict boolean `has_own_chat` before success or cache invalidation. No chat ownership is inferred or coerced. Its public arguments, mutation methods, result fields, SQL name/parameters, snapshots, account checks and success invalidation prefixes remain the same.

The hook exports `UnconfirmedCirclePlanCreationError` and `isUnconfirmedCirclePlanCreation(error)`. Malformed success, thrown transport, returned HTTP 408/5xx, and errors without a known rejection status produce this classification. Returned 4xx rejections other than 408 preserve the original error and ordinary retry. A failure before RPC dispatch remains an ordinary retryable preflight failure. Retired outcomes still become obsolete and do not alter the next entry.

After uncertainty, a retry from the same current account generation, circle ID and stable `scope.isCurrent` function is stopped before another RPC. The hook retains separate active uncertain entries so work in another entry cannot overwrite the earlier protection. Different circles/scopes remain usable. Retired records are removed; account transitions including A→B→A retire old records. No global or permanent lock is introduced. Unscoped compatibility remains: its protection is limited to the same circle/account in that mounted hook, because an omitted scope supplies no finer visit identity.

Validation for the hook continuation:

- `hooks/__tests__/useCreateCirclePlanLifetime.test.tsx`: **41 passed**, including both true/false receipts, malformed values, definite rejection retry, preflight versus transport failure, repeated manual attempts, independent scope/circle behavior, account generations, retirement and unscoped behavior.
- The actual QueryClient is used; auth and RPC are controlled in memory. No live write was made.
- Caller recovery UI and its integration checks are owned by the separate composer continuation; hook tests alone do not establish that UI completion.

The protection is intentionally local to the current hook/visit. Closing and starting a new form, unmounting, or restarting the app does not reconcile an earlier unknown write. The UI must explain that the person should check their plans before posting again; this package does not claim exactly-once creation across visits or devices. Solving that broader boundary would require a separately reviewed server idempotency or reconciliation contract. Nothing in this continuation changes admission rules, audience selection, plan destinations, SQL, providers, or production data.
