# Plan detail join receipt audit — September 14, 2026

This is a local source audit for the isolated Afterglow port. No database, backend, network, notification, or sharing action was performed. Migration files establish the checked-in contracts below; their comments do not establish which definitions are deployed. Route findings describe the source before the concurrent route repair, not verification of that repair.

## Implemented helper

`lib/planJoinSafety.ts` now exports `classifyPlanJoinReceipt(value, rpc)`, `PlanJoinRpc`, `PlanJoinDenial`, and `PlanJoinReceipt`. It retains `joinErrorSurface`.

The result is exactly one of:

- `{ kind: 'joined' }`: exact `joined` text, confirming membership.
- `{ kind: 'denied', reason }`: an exact refusal defined for the selected RPC.
- `{ kind: 'unknown' }`: missing, malformed, unexpected, or wrong-contract data. This is not a refusal and cannot safely enable blind join retry.

An RPC error must be handled before its data is classified. The helper neither converts transport uncertainty into a refusal nor performs a membership check. Neither function has an `already_joined` or `already_member` receipt. Both update an existing membership, so `joined` does not prove this was the first join or authorize replaying a greeting.

## Implemented join controller

`hooks/usePlanJoin.ts` now exposes `{ join, isPending, unconfirmed, isCurrent }`. The route captures the rendered `isCurrent` guard before waiting for participation status or assent. The guard retires after account epoch, target, blur/refocus, or unmount changes. Membership dispatch requires a fresh matching account and exact true for the ordinary gender preflight. Circle joining retains the separate Circle RPC and skips event-message insertion when the plan uses Circle chat.

Pending, confirmed, and unknown results are stored separately by account and plan inside the mounted controller. A different plan/account can proceed independently; a return to the same account/plan cannot replay its pending, confirmed, or uncertain write. Current-only callbacks prevent old results from changing a new screen, while dispatched operations invalidate their original plan/account keys after settling. The query mutation explicitly disables automatic retry.

Readiness gates apply before membership dispatch. They do not suppress the current attempt's confirmed success when its own membership refresh makes the route no longer joinable. After confirmed membership, returned or rejected message errors remain optional-delivery failures, are logged separately, and never become join failures or unlock another greeting attempt. A failed system-message insert still allows the user's greeting attempt.

`onJoined(result: PlanJoinResult)` receives `{}` normally. A returned, rejected, or malformed greeting-write receipt instead produces `{ greetingUnconfirmed: attemptedText }`. The initiating current visit receives this metadata with membership still confirmed. The route retains that text, shows separate introduction recovery, and does not automatically resend or repeat joining. For the direct greeting-sheet path on iOS, the route queues recovery until the sheet's native dismissal. Normal sharing is skipped for this failure. Account, target, blur, and unmount retirement suppress late greeting feedback.

The unknown lock lasts for this mounted controller. It is not durable across unmount/relaunch and is not server idempotency. A joined membership read can let the route show existing member actions; the controller does not unlock from a missing row or replay its join celebration after recovery. Greeting uncertainty is distinct from membership uncertainty; its recovery tells the person to check the chat before sending their retained text again.

## Checked-in RPC contracts

| Function and current definition | Confirmed receipt | Meaning |
| --- | --- | --- |
| `join_event_atomic`, `20260906160000_fix_waitlist_priority_selftest_gender_rule_and_auth.sql:25` | `joined` | Membership updated or inserted as joined. |
| Same | `not_found` | Event lookup found no row. |
| Same | `full` | Stored full status, or joined member count greater than `COALESCE(max_invites, 7)`. Ordinary total capacity is max invites plus the creator. |
| Same | `waitlist_priority` | An active unread waitlist spot exists for someone else and none exists for this caller. |
| `join_circle_plan_atomic`, `20260609141000_circle_plan_join_role_cast_fix.sql:21` | `joined` | Membership updated or inserted as joined. |
| Same | `not_found` | Event lookup found no row. |
| Same | `not_circle_plan` | Event has no Circle ID. |
| Same | `not_eligible` | A nonmember tried to join a Circle-only plan. This particular receipt is not an age/gender decision. |
| Same | `full` | Joined people outside the Circle already reach `COALESCE(stranger_cap, 0)`. Circle members bypass this limit. |

Both functions lock the event row before counting/writing. Both raise an exception for unauthenticated callers or a supplied user ID different from `auth.uid()`. Neither emits an already-joined distinction. A repeat call is not a substitute for resolving a lost response: a capacity check can refuse an already-joined caller before reaching the update, and ordinary joining also updates role and status.

The current `can_join_event_gender` definition (`20260813025124_idor_hardening_round2_ten_more_rpcs.sql:67`) returns a boolean, defaulting to false for missing/ineligible data. A client should require exact true before ordinary joining, not treat null or an arbitrary value as approval. This audit does not establish complete server admission enforcement across all triggers and policies.

## Concrete route findings and smallest repairs

1. **Unrecognized receipt treated as success.** Both join branches rejected only a few known strings and then inserted messages and showed success. The Circle branch also omitted the actual `not_circle_plan` refusal. Use the classifier before any greeting, success feedback, or navigation.
2. **Unknown Circle context becomes an ordinary plan.** `useCirclePlanContext` returns false for missing RPC/null data, and detail uses `!!circleCtx?.is_circle_plan` during loading/error. That can choose the wrong join RPC. Gate admission on a valid current plan/context; retain loading, unavailable, and false as different states. Its context query key also lacks the viewer although `viewer_is_member` is auth-dependent, so account changes must retire or scope that result.
3. **Optional message failure can undo success in the UI.** After a confirmed join, a rejected system/greeting insert bubbles into the join mutation error handler, offering another whole join. A returned insert error is only logged. Keep confirmed membership final, report optional greeting failure separately, and do not replay a potentially delivered greeting after unknown delivery.
4. **Circle capacity text and action disagree.** The header uses ordinary `max_invites + 1`, clamps non-featured attendance to eight, and computes ordinary spots left. The CTA uses Circle outsider spots. This can show Full to a Circle member who may join, or show open spots when the outsider cap is exhausted. Use the Circle model below throughout the detail surface.
5. **Circle chat routing is ignored after joining.** Share/ticket completion always opens `/(tabs)/chats/{planId}`. A whole-Circle private plan with `has_own_chat=false` belongs in `/(tabs)/chats/circle/{circleId}`, an existing destination in `app/circle/[id].tsx:189`. Select the correct destination from valid context and reuse it across all exits.
6. **Waitlist writes announce unconfirmed success.** `handleJoinWaitlist` ignores returned Supabase errors on insert and delete, then changes local membership or says the person is on the waitlist. Check the write result before feedback and prevent duplicate/stale account actions.
7. **Ordinary waitlist does not implement Circle outsider capacity.** The latest `notify_waitlist_on_spot_open` definition (`20260401000000_fix_full_status_bugs.sql:106`) counts all joined attendees against `max_invites`. Circle joining counts outsiders against `stranger_cap` and has no waitlist-priority receipt. The present detail CTA routes full public Circle plans through the ordinary waitlist anyway. Do not claim that this provides Circle spot notifications or priority; a Circle-aware server contract remains separate work.

## Capacity and copy recommendation

`get_circle_plan_context` (`20260609140100_circle_plan_join_rpcs.sql:212`) returns `viewer_stranger_spots_left = max(0, stranger_cap - joined non-Circle members)`. The name includes “viewer” but the number is outsider capacity regardless of whether the viewer belongs to the Circle. It returns null when the cap is null; null is not one available spot.

`create_circle_plan` (`20260824180000_fix_dm_circle_plan_stranger_cap.sql`) validates a public outsider cap of two through seven, capped at six for a two-person Circle. It writes legacy `max_invites=15`; that field is not the Circle admission limit. Whole-Circle private plans use Circle chat; subsets and public plans have their own chat.

Use actual `N going` for Circle attendance, without the ordinary eight-person display clamp. For an eligible public visitor, use `N spots open` and a short explanation such as “Join [Circle name] for this plan.” Keep the real person as the creator. For Circle members, show attendance and their join state without applying the outsider cap. For nonmembers of a Circle-only plan, show its private availability. If context or numeric availability cannot be confirmed, show a recoverable check state rather than an invented count or an enabled join.

## Suggested route result handling

- Before join dispatch: failed identity/context/eligibility reads remain retryable reads; do not send a join request.
- Exact denial: retain the appropriate full, missing, private, or waitlist-priority explanation. A new attempt follows refreshed state.
- Exact joined: refresh membership and affected lists, finalize joining, then handle optional messages separately. Success feedback belongs to the initiating account, plan, and active visit.
- Unknown after dispatch: retain an unresolved attempt, offer a fresh membership check, and block another join and greeting replay. If membership is confirmed joined, show the existing member actions without replaying a greeting or join celebration. A missing/nonjoined row cannot unlock the unknown write, which might still be committing; a failed check also stays unresolved. This is client recovery, not server idempotency or exactly-once message delivery.

## Verification

- `npm test -- --runInBand hooks/__tests__/usePlanJoin.test.tsx lib/__tests__/planJoinSafety.test.ts`: 75 tests passed (62 actual-hook cases and 13 helper/surface cases).
- `npm run typecheck`: passed.
- Helper tests cover both literal success receipts, every contract-specific refusal, null/malformed/unrecognized results, unsupported already-joined strings, and a refusal from the wrong RPC contract.
- Hook tests exercise rapid taps, successful payload/greeting preservation, strict and failed preflights, confirmed refusals versus uncertain data/transport, optional message errors and recovery metadata, malformed greeting receipts, both Circle chat modes, own membership refresh, retired preflight/dispatch/message continuations, account/target return locks, ended plans/content filtering, and offline queued retirement.
- The old source-string integration test was replaced by the main task's actual route/sheet tests; error-surface selection remains directly tested. This avoids asserting obsolete modal source text after extraction.
- Scoped `git diff --check`: passed.
- Route integration and its behavior tests are owned by the main task. Manage, leave, cancellation, and ordinary waitlist write hardening are separate remaining work and are not claimed complete here.
- Handles are displayed only when actually supplied by permitted data. `profiles_public` explicitly omits handles (`20260406000000_remove_handle_from_public_view.sql`); no public-ID enrichment or guessed handles were added.
