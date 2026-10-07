# Notification enable feedback — isolated client review

This package updates the existing Profile and shared ChatThread enable actions. It does not deploy, contact OneSignal, request a real device permission, change subscription preferences, or modify database policy. The local development bootstrap gate remains in place.

## Existing problem and resulting behavior

OS permission alone did not establish that this device had a usable OneSignal subscription or that registration had succeeded. Both actions now use `registerPushNotificationsWithResult` and shared feedback from `components/notifications/pushRegistrationFeedback.ts`. Registered shows success; pending, SDK-not-opted-in, unavailable, and failed remain retryable; obsolete completions are silent. SDK-not-opted-in does not establish that the person deliberately declined.

An explicit Enable action starts with `prompt: false`. Only `permission-required` leads to one prompted call. This is necessary because the installed Android bridge's `permissionNative` implementation maps every false permission to Denied, including an unasked permission (`RNOneSignal.java:465–470`). The structured hook also checks `canRequestPermission`; the callers no longer bypass that classification with the coarse legacy permission helper.

The existing chat reminder still waits for another person's message and uses the existing seven-day dismissal key. A confirmed prior denial retains the existing Settings action. A freshly declined native prompt only hides/snoozes the chat reminder; it does not immediately redirect the person to Settings. No pending/error/unavailable result writes a denial cooldown. The prompt placement and explicit dismissal policy remain unchanged.

Profile notification actions are bound to the visible account and focus visit, independently of a potentially stale profile fetch. Chat actions are bound to the current room/account entry and focus visit. Each has a synchronous attempt lock. A blur, account change, or room return retires pending callbacks. A new Profile attempt also retires earlier notification alert callbacks, so a late Settings-open failure cannot overwrite a newer result.

Chat rechecks registration only after returning from that visit's explicit Settings action. This recheck never prompts and never reopens Settings. An early foreground event is retained until the initiating attempt releases its lock. Repeated foreground events and retained listeners from an older room do not initiate more registrations.

## Verification

`NotificationEnableFeedback.test.tsx` renders the actual Profile and ChatThread components with mocked native/provider boundaries. It includes 27 cases covering synchronous double taps; account A→B→A; blur and fresh focus; failed, pending and unavailable outcomes; coarse Android denial versus permission-required; fresh decline versus prior denial; ordinary and early Settings return; stale return callbacks; and late Settings errors. A context-backed focus mock exercises updates through ChatThread's React memo boundary.

The earlier 15-case caller suite passed but omitted the classification and return races. Expanded tests reproduced nine failures before the repair, including expected-contract assertions and the concrete Settings-return/late-alert races. Final regression run: **127/127 cases across four suites**:

```sh
./node_modules/.bin/jest --runInBand --ci --watchman=false --silent \
  --cacheDirectory=/private/tmp/washedup-notification-caller-review-jest \
  components/chat/__tests__/NotificationEnableFeedback.test.tsx \
  hooks/__tests__/usePushNotifications.lifetime.test.tsx \
  components/chat/__tests__/ChatThreadComposerMedia.test.tsx \
  components/chat/__tests__/ChatThreadEntryLifetime.test.tsx
```

No full TypeScript check was run in this subtask; the integrating task owns it. These are component/hook tests, not evidence of native OS dialog behavior, actual device delivery, or a successful server-side subscription transfer.

## Boundaries left visible

- The passive chat-banner discovery still uses the existing OS permission heuristic. After navigating away, a device with granted permission but failed registration does not automatically gain a new reminder. This package preserves that reminder policy; explicit Profile Enable remains available. A more complete recovery reminder needs a separate agreed policy.
- The legacy root primer still uses the string-or-null wrapper. Its copy/cooldown integration is a separate package.
- `device_tokens` ownership-transfer/RLS limitations are documented in `onesignal-client-lifetime-2026-09-13.md`; truthful failure feedback does not resolve that server boundary.
- Native requests or writes already dispatched cannot be recalled. The guards prevent later stale UI work and further caller actions; they do not claim cancellation of work already sent to a provider.

## Final integrated check

The combined nine-suite client/card run passes **194/194**, full app TypeScript passes, static auth invariants pass, and scoped diffs are clean. [Combined log](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/notification-reliability/integrated-client-card-tests.log>). Actual browser review covers the selected card at 300/375/430 and the shared chat’s pending, failed and successful enable-feedback states with synthetic registration results. This does not establish native OS or provider delivery.
