# Notification return after phone verification — local repair

September 13, 2026. Changes remain in the isolated local checkout. No production build, deployment, authentication request, or data change was performed.

## Reproduction and behavior

The mounted `RootLayout` → `VerifyCodeScreen` → `TabLayout` reproduction previously lost `/community-topic/topic-a` when a signed-out person tapped its notification and verified their phone. Root deferred the tap, Verify entered Plans after its success hold, and root's authorization destination still reflected the earlier signed-out route. The baseline failure is recorded in `/private/tmp/washedup-notification-verify-handoff-baseline-2026-09-13.log`.

The repaired flow gives that verification attempt one account-bound handoff. Verify supplies the same `authedDest` result after its 600 ms hold. Root first approves the existing ban check, commits the base route, and then waits for the existing Tabs profile and phone gate before resuming protected navigation. A completed checkout has priority, followed by a saved link and then the buffered notification. An unfinished checkout does not mask the link. The existing transfer route remains available when none of those destinations exists.

The root handoff is the only pending-destination consumer during this visit. It releases the visit after consumption, so subsequent auth events do not replay the notification. Incomplete onboarding retains the destination until a later Tabs mount approves entry. A timed-out Tabs gate remains closed and retries on a subsequent auth recovery event. Legacy tab-mount routing outside a verification visit is retained.

## Lifetime and gate boundaries

- Migration `USER_UPDATED` events bind and approve the visit even when Supabase does not emit `SIGNED_IN`.
- Signout, account changes including A → B → A, and password recovery invalidate old handoffs and awaited auth work. `INITIAL_SESSION` remains owned by the cold-start auth check.
- Verify leaving during the OTP request, success hold, profile lookup, or an uncommitted destination proposal cancels the attempt. Only root's committed route transfers ownership beyond Verify's unmount.
- Migration profile synchronization runs alongside the success hold and must settle before automatic navigation. Its existing failure alert suspends the visit; dismissal continues through root's ban approval and the Tabs entry gate. A stale alert cannot navigate after the account changes.
- Durable destination consumption checks the caller's lifetime after its asynchronous storage read, before removing the saved destination. Root checks the same lifetime again before navigation. Unexpected handoff rejections release ownership; storage helpers retain their existing best-effort behavior.

The storage predicate prevents an obsolete read from starting removal. It cannot cancel a removal already dispatched to AsyncStorage and is not a cross-process atomic consume or compare-and-swap operation. Tests prove single-consumer ownership within the verification flow and the specified deferred-read boundary; they do not prove every storage race across independent mounts or processes.

Phone migration's existing definite-true RPC rule, onboarding destinations, ban fallback policy, notification payload-to-route mapping, the success-hold duration, and `usePushNotifications(authedUserId, { identityResolved: authResolved })` are retained. Destination navigation does not replace each room's existing access checks.

## Local verification

`app/__tests__/notificationVerifyHandoff.test.tsx` mounts the actual three layout/screen components with mocked native, auth, and storage boundaries. Its 26 scenarios cover exact destination and consume-once behavior, checkout/link priority, incomplete onboarding, delayed and blocked profile/phone gates, migration `USER_UPDATED`, delayed bans, signout/recovery, account ABA, storage reads, unmount at multiple wait boundaries, sync-failure alert continuation, and gate recovery after timeout.

The focused command below passed **57 tests across four suites**:

```sh
node_modules/.bin/jest --runInBand --ci app/__tests__/notificationVerifyHandoff.test.tsx lib/__tests__/pendingLink.test.ts lib/__tests__/authRouting.test.ts lib/__tests__/phoneFormat.test.ts
```

`node scripts/release/check-auth-invariants.mjs` and the scoped `git diff --check` also passed. These are mocked local lifecycle checks, not native push, authentication, or server end-to-end proof. Native OneSignal cold-start replay, real OTP delivery, and device navigation transitions still require a device walkthrough before release.

Changed source files: `app/_layout.tsx`, `app/(auth)/verify-code.tsx`, `app/(tabs)/_layout.tsx`, `lib/navState.ts`, and `lib/pendingLink.ts`. Test files: `app/__tests__/notificationVerifyHandoff.test.tsx` and `lib/__tests__/pendingLink.test.ts`.

## Final integrated check

The combined nine-suite client/card run passes **194/194**, full app TypeScript passes, static auth invariants pass, and scoped diffs are clean. [Combined log](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/notification-reliability/integrated-client-card-tests.log>). Actual browser review covers the selected card at 300/375/430 and the shared chat’s pending, failed and successful enable-feedback states with synthetic registration results. This does not establish native OS or provider delivery.
