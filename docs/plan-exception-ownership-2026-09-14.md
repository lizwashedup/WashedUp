# Plan exception acceptance and decline

Bounded local repair in the existing plan-detail route. No SQL, provider changes, live actions, waitlist membership actions, leave/manage writes or new Circle exception policy.

## Preserved contract

`lib/waitlistExceptions.ts` remains the authoritative transport wrapper. Saved migration `20260518220000_waitlist_exceptions_rpcs_waitlister.sql` defines `accept_waitlist_exception(p_event_id uuid)` and `decline_waitlist_exception(p_event_id uuid)` as `RETURNS void`, using `auth.uid()` and the invited waitlister’s locked row. Acceptance joins `event_members` and removes the waitlist row. Decline marks the exception declined and refunds its slot. Neither helper returns a Circle conversation policy. The existing acceptance destination remains the event’s plan chat.

The status and assent helpers, legal copy, notice requirements, error mapping, notification filters, acceptance/decline feedback and original query invalidations remain. Missing participation-status RPC codes retain the existing dormant behavior; other returned status failures still ask for assent. This package does not reinterpret the saved server contract or assert that it has been deployed.

## Ownership changes

`hooks/usePlanExceptionActions.ts` owns the exception operation from the first status check through the notice, explicit assent and final RPC. It captures the original viewer, account generation, event and focused visit. A synchronous shared lock prevents accept/decline overlap, including the time before React renders a pending state. Fresh `getUser` checks confirm the exact initiating viewer before status, assent, acceptance/decline and the optional inbox update.

Every notice has a unique guard. A cancelled notice cannot approve or dismiss a subsequently opened one in the same focused visit. Assent pending prevents cancellation; a failed assent retains the original notice’s retry behavior. Preflight failure after confirmed assent releases the lock and uses the plan’s existing alert instead of leaving a hidden notice pending.

`onNoticeComplete` may now return a promise. The iOS plan route resolves it after the legal notice’s native dismissal, before exception acceptance can run. The hook checks the original account/visit again after that wait. Queue cancellation or late dismissal after blur cannot dispatch an acceptance. Existing synchronous callers retain their behavior.

Blur, unmount, account generation or target changes retire late continuations. Pre-dispatch work cannot subsequently accept or decline. A write already dispatched keeps its per-plan lock through a same-screen refocus until it settles. Confirmed completion cannot send notifications or invoke current-page success/navigation callbacks from a retired visit. Original inbox cleanup remains best-effort; its failure does not make a confirmed acceptance retryable. This is client operation ownership, not cancellation of a dispatched server action or new server idempotency.

`lib/planParticipationScope.ts` also binds the ordinary join notice’s existing assent call to its exact account/notice. The route uses an immediate agreement lock, guards the captured notice before and after each await and does not clear a newer notice’s lock when an old attempt settles. The legal notice itself is unchanged.

Two separately requested route corrections are included: live `effectiveIsEligible` now participates in `joinReady` while preserving the existing Circle-member bypass; participation-status errors from direct Circle-member joining surface in the branded alert when there is no open greeting sheet.

## Verification

`npx jest --runInBand --ci hooks/__tests__/usePlanExceptionActions.test.tsx`: 37 tests passed. Tests use the actual waitlist and participation helpers with mocked auth/RPC transport, covering exact payloads and VOID receipts, rapid taps, status/assent locks, same-visit notice replacement, failed assent/preflights, dormant/missing status behavior, delayed auth/status/assent/RPC results, account A→B→A, target changes, blur/refocus/unmount, notification failure, ordinary-notice ownership and the deferred native-dismissal boundary.

`npx tsc --noEmit --pretty false` and scoped `git diff --check`: passed. Parent-owned route/component integration tests and local browser verification run separately. Actual native navigation, consent modal presentation and deployed server integration remain device/integration checks; no real acceptance or decline was performed.
