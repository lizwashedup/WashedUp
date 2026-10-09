# Sentry repair — October 9, 2026

Liz requested investigation, fixes and delivery for this morning's Sentry errors.
This work starts from published canonical `main`
`c9c96d55f0e3a95e0ee3ad55104bdf3cb3392acf` in an isolated worktree on
`fix/sentry-morning-20261009`. The historical Build 51 release branch remains
untouched. No database, notification-provider or native configuration change is
part of the OTA candidate.

## Observed incidents

Sentry project `washedup/react-native`, all environments, empty issue query,
last 24 hours, inspected October 9 around 1:17 PM PDT: four groups / five events.
Counts describe this observation window, not the number of emails or a crash rate.

| Issue | Most recent event, PDT | Attribution | Disposition |
| --- | --- | --- | --- |
| [4W](https://washedup.sentry.io/issues/7783807231/) | Oct 9, 11:03:22 AM | Handled `useChat.fetchMessages.getUser` deadline; current iOS OTA `01a11e1d-09a0-73e8-9c16-1bca74895a0d`; app outside foreground | Candidate retires suspended history work and uses the existing foreground refresh. |
| [4X](https://washedup.sentry.io/issues/7784012139/) | Oct 9, 1:05:19 PM | Native `Failed to preempt running transition`; embedded Build 51 update `079a11b6-0662-4e44-b286-86df21b0bf46`, iPhone Air / iOS 27.0 | Exact archive symbols identify `RNSScreenStackView prepareForRecycle`; requires a native repair and device verification. Not fixed by this OTA. |
| [4V](https://washedup.sentry.io/issues/7782390877/) | Oct 9, 6:12:54 AM | Handled `useChat.hydrateNewestPage` deadline on previous iOS OTA `01a11565-639d-7078-95e9-c943eb154eae`; two events in this window | Real foreground network failures remain reportable and retryable. The other event was background auth work. This group is not proof of a regression in yesterday's update. |
| [4B](https://washedup.sentry.io/issues/7763973089/) | Oct 9, 11:36:48 AM | `AuthRetryableFetchError: Network request failed`, `useActiveChatPresence`, Android 1.0.7 (18), embedded update `667a2aab-8525-4675-8293-b192c9e73d54` | Android has no verified OTA target in this release. Network failure is not an invalid-account signal; no auth/privacy weakening or silent error filter was added. |

The seven-day list also contained older incidents. Sampled recent context:

- [4T](https://washedup.sentry.io/issues/7781623922/): October 8, 10:35 AM auth process-lock timeout on older OTA `01a0fb0d-9ba2-7511-b713-28250a169115`.
- [4S](https://washedup.sentry.io/issues/7781050579/): October 8, 5:58 AM involuntary-sign-out telemetry on embedded Build 51. Breadcrumbs show a refresh-token request returning HTTP 400; this does not establish why the server rejected that token. Do not suppress real session invalidation. The displayed source excerpt does not align with the event's function, so it is not trustworthy line-level evidence for that embedded bundle.
- [4C](https://washedup.sentry.io/issues/7764430329/): October 8, 8:58 AM on the old embedded Android build, `plan.departure.announcement`, PostgreSQL `42501` message-insert RLS rejection. This optional announcement failure is separate from the confirmed departure. Changing membership access to permit it would require a separate policy review; this release does not weaken RLS.
- [4R](https://washedup.sentry.io/issues/7779905348/), [4N](https://washedup.sentry.io/issues/7769779093/) and [2S](https://washedup.sentry.io/issues/7644427523/) retain the native keyboard/clipboard and mixed preview/production watchdog limits documented in `docs/sentry-blocking-live-audit-2026-10-07.md`. They are not marked fixed.

## OTA change

`useChat` previously scoped history/auth/hydration to its account, room and read
window. A suspended read could remain current while the app was backgrounded,
then log a timer deadline and start session fallback after a long OS suspension.
The 4W event has a background breadcrumb at 10:26:38 AM and the deadline at
11:03:22 AM, with no intervening foreground breadcrumb. This supports the
suspension diagnosis; it does not mean the visible chat waited 37 minutes.

The candidate:

- Does not start history reads while the app is inactive/backgrounded, including
  realtime-readiness refresh callbacks.
- Retires existing history/hydration reads on suspension and scopes their auth,
  blocking, read-marker and notification-clear work to that read generation.
- Retains loaded history, draft and send ownership. An already-dispatched send
  can still finish; it is not retried as a side effect of returning to the app.
- Uses the existing focused-chat resume refresh. Real foreground errors still
  report to Sentry and keep the existing same-account fallback and retry behavior.

No Sentry issue was resolved/archived, sampling/filter changed, or alert disabled.

## Native crash: exact attribution and proposed next step

Event `0b7f21b7e0d24a639d19278dba02a2aa` reports an app image UUID matching the
saved Build 51 archive: `1D18E2C9-C334-31B2-B8B3-C1CBAF61F1FA` (arm64).
`dwarfdump --uuid` confirms the match. Local `atos` with load address
`0x102548000` and instruction address `0x1029a35e0` resolves to
`-[RNSScreenStackView prepareForRecycle] (RNSScreenStack.mm:1494)`.
The enclosing stack passes through Fabric view recycling, empty-tree commit,
surface shutdown and `UIApplication _terminateWithStatus:`. The failure is in
native navigation teardown, not evidence of a JavaScript scroll loop.

Installed `react-native-screens` 4.16.0 resets its navigation controller's view
controllers during recycling. React Native 0.81.5 supports the component class
opt-out `+ (BOOL)shouldBeRecycled`; several other screens components already use
it. A narrow native candidate is to opt this stack out as well, preventing
Fabric from calling this recycling reset during an active UIKit transition.
This is a proposed mitigation, not a validated native fix: modal/controller
cleanup, allocation growth and transition behavior require a signed/device
validation pass. Do not swallow the Objective-C exception or globally remove
navigation animations to conceal it.

Reference implementations:
- `node_modules/react-native-screens/ios/RNSScreenStack.mm:1482`
- `node_modules/react-native-screens/ios/RNSScreen.mm:1212`
- `node_modules/react-native/React/Fabric/Mounting/RCTComponentViewRegistry.mm:110`

No dependency patch or native build is activated by this repair. The shared
`/Users/liz/Desktop/WashedUp/NEXT-NATIVE-BUILD.md` records the native work. Build
51 dSYM upload is also needed for Sentry's server-side symbolication. The saved
archive exists; upload requires the existing Sentry credential, which was not
retained locally after yesterday's release.

## Verification and delivery checkpoint

- Regression tests reproduce the missing lifecycle boundary before the fix:
  three of four initial cases fail on unchanged source; the send-preservation
  case already passes.
- Focused ownership/resume tests: 116 passed, including seven new lifecycle
  cases. TypeScript passes after the final test-key typing correction.
- Full isolated Jest: 567/567 suites, 8,671 tests passed, zero failures, one
  pre-existing pending database acceptance case. Production iOS Hermes export
  with source maps and web export both pass. Independent release CI and final
  publication status are recorded in the PR when complete; publication is not
  claimed by this checkpoint.
- The native dependency/configuration/lockfile contract is unchanged. This
  JavaScript repair is eligible for the existing iOS Build 51 OTA guard; it
  cannot fix the separate native crash or deliver to Android.

Evidence directory:
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/sentry-repair-20261009`.
Native symbol archive:
`/Users/liz/Desktop/WashedUp/Implementation/takeover-20260927/apple-launch-rejection-release-plan/build51/archive/WashedUp-1.0.7-51.xcarchive/dSYMs/WashedUp.app.dSYM`.

If this candidate is published, the immediate app rollback target is the
verified October 8 iOS group `efe45b8c-c6ed-4a3e-ac5c-5a62abe5aeb8`. Retain the
deployed account/push/blocking protections; no database rollback accompanies
this JavaScript change.
