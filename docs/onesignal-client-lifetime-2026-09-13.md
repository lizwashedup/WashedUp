# OneSignal client identity and tap audit

This package changes only the isolated native client hook and its inert web shim. The local-development guard remains enabled. No SDK/account operation, permission prompt, database write, simulator action, notification send or production deployment was performed during this work.

**Open server boundary:** a device subscription previously stored for account A can fail account B's registration because the checked-in token table permits updates only by its existing owner. This client package does not solve that ownership transfer or establish end-to-end delivery. The exact constraint and next review are recorded below.

## Implemented client repair

The root remains the single identity owner. Its call is now `usePushNotifications(authedUserId, { identityResolved: authResolved })`; this distinguishes startup's unresolved `null` from a confirmed signed-out account. Existing one-argument calls remain accepted, with `undefined` treated as unresolved. Explicit registration waits for a current identified root account; a mismatching or retired caller receives `null`.

`hooks/usePushNotifications.ts` now:

- Unlinks the native external identity after confirmed sign-out, including signed-out startup. It does not opt the device in or out, change OS permission, or log out a newly bound replacement identity.
- Retires the previous account's work synchronously on a Supabase auth event. A separate observer survives binding retirement and advances a visit epoch, so A → B → A between root renders creates a fresh A binding while old A callbacks remain invalid.
- Rejects old initial subscription reads, queued subscription callbacks, pending manual permission/ID reads, and post-write results after identity retirement. Known auth state must match the resolved root prop before that prop can bind the SDK.
- Uses the installed SDK's `getPermissionAsync()` instead of its initially-false synchronous permission cache. Explicit permission requests keep the existing `requestPermission(true)` argument and CTA timing. Passive calls never request permission. Concurrent explicit calls share the pending OS request and registration; the queued SDK call checks ownership again before presenting.
- Checks `getOptedInAsync()` and treats newer subscription events as authoritative over older reads. An opt-out or token rotation during initialization/manual registration cannot save the older subscription. There are no `optIn()` or `optOut()` calls.
- Serializes simultaneous writes for the same device within one account visit. A failed/rejected/retired write returns `null` to manual registration instead of reporting success. The existing `device_tokens` payload and `onConflict: 'onesignal_player_id'` remain unchanged.
- Allows a later caller to retry a synchronously thrown initializer. Successful initialization stays singleton; there is no automatic retry or prompt loop.

The web shim gained inert `logout`, `getPermissionAsync`, and `getOptedInAsync` methods solely to match the shared interface. Native imports and the `LOCAL_DEVELOPMENT_ONLY`/web guards remain intact.

Permission acceptance and completed registration are different results. The preserved `string | null` registration wrapper returns an ID only when the current subscription and any requested token write succeed. Its `null` still conflates several states for backward compatibility. The structured API below now distinguishes them for caller feedback. The passive subscription listener may complete registration later after someone accepts the OS prompt; neither API is proof of native delivery. Caller copy/cooldown integration is owned separately; this hook package does not change prompt placement, timing or cooldown policy.

## Structured registration outcomes

`registerPushNotificationsWithResult(options: PushRegistrationOptions = {}): Promise<PushRegistrationResult>` is exported alongside the original `registerForPushNotifications`. Options remain `{ prompt?: boolean; userId?: string | null }`. There is no new scope argument: the function captures the current account visit synchronously at entry. Callers still own guards for their UI and any earlier awaits before invoking it.

| `status` | Meaning |
| --- | --- |
| `registered` | A current subscription ID and any requested token write succeeded. This is the only case with `subscriptionId: string`. |
| `permission-denied` | A passive native read confirmed denial, or an explicit native permission request returned `false`. A thrown request never becomes denial. |
| `permission-required` | A passive probe found permission undetermined or a native permission request still available. No prompt was opened. |
| `opted-out` | The SDK currently reports `getOptedInAsync() === false`, or a newer subscription event reports inactive opt-in. This does **not** establish that the user deliberately opted out; it can be transitional after granting permission. |
| `pending` | The subscription ID is still missing after the existing one-time 1.5-second retry, or newer subscription state superseded the read. The listener can finish registration later. |
| `failed` | Initialization, binding, permission/subscription reads, or token registration failed or returned an unusable result. It does not mean user rejection. |
| `obsolete` | The initiating account visit retired, or the supplied user ID conflicts with the current account. |
| `unavailable` | Local-only/web mode or no resolved identified root owner permits registration. |

The legacy wrapper maps `registered` to its subscription ID and every other result to `null`. Both APIs share the same pending request and write locks, so an old and a new caller tapping concurrently still produce one request and one registration. The wrapper remains available to root's existing primer. This package adds no `optIn`/`optOut`, extra permission dialogue, scheduler, routes or database contract.

The installed Android bridge (`react-native-onesignal/android/src/main/java/com/onesignal/rnonesignalandroid/RNOneSignal.java`, `permissionNative`) maps every false permission to the Denied enum, including a permission that has not been requested. Passive Android classification therefore checks `canRequestPermission()` first. iOS uses its native NotDetermined/Denied distinction. Unknown/inconsistent reads are `failed`; they do not justify a denial cooldown or assuming that Settings is required.

## Evidence

Before source changes, the first actual-hook suite reproduced 10 failures with 6 preservation cases passing. Follow-up tests reproduced an initial subscription read overwriting a newer opt-out, then an auth-only A → B → A permanently retiring registration. Both now pass.

The first identity package passed **25/25 tests** in `hooks/__tests__/usePushNotifications.lifetime.test.tsx`, and full checkout `tsc --noEmit --pretty false` passed after its observer repair and root integration. Those original 25 tests remain intact. The structured-result follow-up now passes **41/41**: 16 added cases distinguish explicit denial from request/read/write failure, unasked passive permission, Android's coarse denial enum, inactive subscription state, pending ID plus later listener registration, stale account completion, malformed bridge response and mixed old/new API deduplication. Tests use React's actual hook lifecycle, deferred SDK/database adapters, synchronous auth events, and the existing test network-egress block.

The combined native-hook/time-picker run also passed all 34 checks. [Final integration log](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/notification-reliability/native-and-time-tests-2026-09-13.log>), the frozen native baseline, and the source-fragment audit scripts are saved in the same evidence directory. Static auth invariants passed without changing authentication routes or gates. Independent final review confirmed the auth-only A → B → A repair.

```sh
./node_modules/.bin/jest --runInBand --ci --watchman=false --silent --cacheDirectory=/private/tmp/washedup-push-client-jest hooks/__tests__/usePushNotifications.lifetime.test.tsx
./node_modules/.bin/tsc --noEmit --pretty false
```

## Separate notification destination finding — not changed

The current `app/_layout.tsx` click handler correctly maps sender payloads containing `eventId`, `circleId` or `topicId` to plan chat, circle/DM chat and community topic routes. Album IDs route to the existing album screens. `supabase/functions/send-push-notifications/index.ts` supplies these fields. Broad community notifications intentionally carry no destination ID and fall back to Chats or Scene; a more specific landing would require a separately agreed payload contract.

There is a signed-out phone-verification gap:

1. `safePush` in root layout stores the notification destination only in `pendingDeepLinkRef` (around lines 272–275).
2. `honorPendingDeepLink` requires `authedDestRef` to begin with `/(tabs)` (around lines 261–270).
3. The self-routing verify-code auth branch claims the user and sets auth resolved, but does not update `authedDestRef` (around lines 981–988). A preceding signed-out startup stamped `/phone-entry` there.
4. The verify-code screen can finish its own successful navigation while root's honor gate still holds the old signed-out destination. The later same-user auth branch also leaves that destination unchanged. This push was not durably stashed for the tabs' pending-link consumer.

The scratch audit `/private/tmp/washedup-push-client-audit/tap-routing.cjs` executed the actual current click/honor/verify-code source fragments: four existing destination mappings passed, the signed-out gate correctly held the link, and the post-verify-code gate still held it. This is a source-fragment reproduction, **not** an actual root-navigation integration test.

Smallest proposed next repair: establish a tested, explicit successful-auth destination handoff from the self-routing verification flow to the same pending-link consumer, preserving ban/onboarding/phone-migration gates and consume-once behavior. First reproduce the whole route transition with mocked root navigation/auth; include unsuccessful verification, blocked onboarding, warm taps, duplicate taps and signed-out-to-different-account cases. Do not weaken the gate to merely checking `userId` or add guessed notification routes.

## Limits and follow-up

- OneSignal's installed `login`/`logout` APIs are void. Calling them is not proof of server alias propagation or device delivery. Native confirmation remains separate; the simulator fixture has not completed its launch.
- A native permission dialog or database request already dispatched cannot be recalled. Ownership checks prevent later client writes/continuations where possible and reject obsolete completion results. They do not reverse a request already accepted by the server.
- Token ownership transfer still needs a server contract review. The checked-in `20260501000002_create_device_tokens.sql` gives `onesignal_player_id` a unique constraint and restricts UPDATE to the current owner. If an account switch reuses A's stored subscription ID, B's upsert can be rejected by that policy; sender eligibility requires a token row for B. This package reports the rejected write honestly but does not loosen RLS, migrate rows, delete another account's data, or assert that deployed production policies match these files.
- Caller UI may still need independent lifetime guards after awaiting permission status (for example a stale chat callback opening Settings or hiding a different chat's banner). The hook protects SDK registration and token ownership, not every caller's UI callback.

## API references

The installed `react-native-onesignal/dist/index.d.ts` documents native `login`/`logout` as void, `getPermissionAsync`/`getOptedInAsync`/`getIdAsync` as asynchronous, and `hasPermission` as deprecated. Its `dist/index.js` initializes the cached permission to false and populates it via an unawaited observer read during `initialize`.

OneSignal's official [mobile SDK reference](https://documentation.onesignal.com/docs/en/mobile-sdk-reference#loginexternal_id) says to bind after a known sign-in/session restore and on account switches. Its [logout reference](https://documentation.onesignal.com/docs/en/mobile-sdk-reference#logout) describes unlinking only this mobile subscription from the external ID. The [push subscription and permission reference](https://documentation.onesignal.com/docs/en/mobile-sdk-reference) distinguishes OS permission from subscription opt-out. These references support the client API choices; they are not evidence that this app's delivery was tested.
