# Plan joining: Circle context and form

Local isolated source only. No SQL, live reads, admission rules or provider changes. The plan route and its actual-component visual review are integrated separately.

## Circle context

`hooks/useCirclePlanContext.ts` now takes an optional second argument containing `viewerId`, observed account `epoch`, a stable `isCurrent` predicate and the matching loaded `event: { id, circle_id }` snapshot. Callers must keep missing `circle_id` as `undefined`, and gate coordinated actions on `isContextReady`.

The saved `get_circle_plan_context` SQL in `supabase/migrations/20260609140100_circle_plan_join_rpcs.sql` returns `{ is_circle_plan: false }` for both an absent event and an ordinary event. It cannot establish ordinary provenance by itself. An authoritative matching event with explicit `circle_id: null` now confirms ordinary context after an exact current-viewer auth check, without requiring the optional Circle RPC. A known Circle requires the RPC’s full valid receipt: matching Circle UUID, actual membership/chat booleans, nullable name, known visibility and coherent counts. Open capacity is a configured integer from 2 through 7; remaining stranger spots can be zero and must not exceed capacity. Private Circle capacity/remaining values stay null. False, missing, malformed, denied and missing-RPC results never become ordinary-plan context.

Query cache identity includes viewer, account generation, event and provenance while preserving the existing `circle-plan-context`/event invalidation prefix. Reads check ownership before and after auth/RPC awaits and attach the query abort signal. Current data is masked during a refresh and after a failed refresh. A retained `refetch` rejects if its original owner has retired; the caller’s recovery handler must catch that cancellation.

48 real-query-client tests cover receipt contracts, missing RPC, unknown provenance, ordinary compatibility, auth failure, account A→B→A, target changes, aborted reads, late results, cache isolation and refetch/invalidation behavior. The saved SQL is evidence of the repository contract, not a claim that it is deployed.

## Join sheet

`components/plans/PlanJoinSheet.tsx` is a controlled presentation component. Optional `appearance: { fonts }` uses the reviewed cream/Mona/clay tokens; default fonts, palette and small-plan copy remain. `planId` should be supplied even when multiple plans have the same title/date. All draft and admission ownership remains with the parent.

The greeting stays required, has its original 200-character input limit, and is posted to the chat by the original joining action. The explicit “I’m coming” checkbox remains required. Closing does not change either controlled value. The title, date, field, helper, checkbox and errors scroll above a fixed minimum-48-point Join action. Close and the checkbox have minimum-44-point targets; current window height, safe-area padding and keyboard avoidance keep the form reachable on short screens.

`onJoin` and `onCheck` accept promises; return the parent’s actual work so the sheet can immediately block duplicate taps and edits/dismissal while pending. Parent `busy` also blocks actions before a callback starts. Parent-classified definite failures preserve the original retry behavior. An unknown receipt replaces Join with Check plan and retains the greeting without enabling another submission. An unexpected thrown join callback also takes this conservative local Check path; it never claims success or interprets transport text.

The current Modal stays mounted through `visible=false` so native iOS dismissal can precede the existing sharing modal. Only one current-visit `onDismiss` is delivered. Reopen, target replacement and unmount retire old input/action/close/dismissal callbacks and late async feedback. This is local callback protection, not server idempotency or cancellation of an already dispatched join.

The plan route now queues native iOS transitions by source Modal and exact pending operation. The greeting sheet fully dismisses before participation appears; after confirmed assent, participation fully dismisses before joining can produce fast sharing or error feedback. Exception acceptance also awaits this dismissal. Cancellation waits for the notice to leave before enabling the underlying join controls. A duplicate callback or a callback from another hidden Modal cannot consume the transition. Blur/unmount cancels awaited transitions with an obsolete-operation result, so delayed dismissal cannot join another visit. Web and Android retain immediate transitions.

`ParticipationNotice` adds optional `onDismiss` without changing its legal body or assent copy. It maintains one native dismissal callback per visible visit, starts a reopened notice unchecked and guards pending agreement, close, checkbox and late-result callbacks. A thrown agreement uses the original retry line. No consent is recorded or inferred by the visual component itself.

21 focused component tests cover admission controls, exact controlled draft preservation, pending/duplicate actions, unknown-versus-definite recovery, hidden/closed/reopened/replaced targets, native dismissal sequencing and short-screen content/footer anatomy. Device keyboard/safe-area behavior, actual iOS modal transitions and route/service integration still require the parent’s separate visual/device verification.

## Local checks

- `npx jest --runInBand --ci hooks/__tests__/useCirclePlanContext.scope.test.tsx`: 48 passed.
- `npx jest --runInBand --ci components/plans/__tests__/PlanJoinSheet.test.tsx`: 21 passed.
- `npx tsc --noEmit --pretty false`: passed.
- Scoped `git diff --check`: passed.

The final modal-sequencing checks pass 103 tests across four suites: route presentation/choreography (36), real-helper exception ownership (37), join sheet (21) and participation-notice lifetime (9). Full TypeScript and scoped diff checks pass. These verify React callback and native-dismissal event ordering with controlled callbacks; actual iOS animation/keyboard presentation remains a device check.
