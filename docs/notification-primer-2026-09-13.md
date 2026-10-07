# Notification reminder: accurate completion and dismissal

September 13, 2026. Isolated candidate only. No app release, production data change, provider setting change, device registration or real notification was performed during verification.

## Result

The root reminder previously disappeared immediately after Enable and discarded the nullable registration result. It now stays pending until registration completes, offers honest inline retry feedback if it does not, and keeps dismissal available. Its staged appearance uses the existing cream/ink/clay and Mona tokens. The short copy explains messages/plan updates/reminders and that individual chats can be muted.

The optional appearance is enabled with the existing local community-chat development switch. Legacy presentation remains available without it. The bottom navigation, notification recipients, chat mutes and delivery timing are unchanged.

## Behavior and ownership

- Native eligibility is checked only after the existing authenticated survey/review decision. A new read-only eligibility helper distinguishes requestable, answered and unavailable. iOS validates native numeric permission enums; Android distinguishes its coarse denied state through validated permission/requestability reads. Unknown or failed reads never manufacture an unasked-permission result.
- Eligibility may initialize the existing SDK readiness path, but never requests permission, binds an external user, opts a subscription in, or saves a token. It is inert on web and in the local-only build.
- Enable first checks/repairs registration passively for the current account. Only `permission-required` permits a prompted call. Granted-but-pending, inactive, unavailable and failed registration keep a retry message; they do not write a snooze or pretend the user declined.
- Registered closes the reminder. Permission denial closes without opening Settings automatically. An obsolete attempt closes silently. The existing device-level seven-day Not now key and duration remain; dismissal writes that choice even during a pending attempt.
- Account epoch, visit and attempt ownership prevent old A → B → A callbacks from operating a new modal. Switching accounts also allows a check cancelled by the new survey/review decision to run once that decision completes. Already-shown visits remain consumed.
- Survey/review takeover, a root alert or dismissal retires the attempt. The prompted helper now accepts `canPrompt`, checked immediately before creating or joining a native permission request. Guarded calls are deduplicated by their own callback identity; concurrent eligible calls still share the one OS request. This prevents a slow native permission read from opening a new sheet after Not now. An already-open OS sheet belongs to the OS and is not programmatically cancelled.
- The close control is fixed above scrollable content. Buttons have 44-point minimum targets, one-line labels, pending/disabled semantics and named accessibility controls. Feedback is exposed as an alert/live region; native spoken behavior still needs device review.

## Source

- `app/_layout.tsx`: root eligibility, account/visit/attempt guards, feedback and existing cooldown integration.
- `hooks/usePushNotifications.ts`: precise eligibility and final caller-current prompt guard; prior identity/registration protections retained.
- `components/PushPrimerModal.tsx`: pending, feedback, optional staged appearance and scrollable presentation.
- `app/__tests__/pushPrimerLifecycle.test.tsx`: mounted actual RootLayout, presentation/provider boundaries mocked.
- `hooks/__tests__/usePushNotifications.lifetime.test.tsx`: actual helper and registration logic with synthetic SDK/storage.
- `components/__tests__/PushPrimerModal.test.tsx`: actual presentation and accessibility contracts.
- The older verification-handoff test harness now mocks the new read-only eligibility export as answered.

## Verification

**230 tests in eight suites pass**, full app TypeScript passes, static auth invariants pass, and the scoped diff check passes. Breakdown: root reminder 46; OneSignal lifetime/eligibility 94; primer presentation 6; Settings/chat enable 27; mounted notification verification handoff 26; pending links 21; auth routing and phone format 10.

The root tests reproduced two real intermediate defects before repair: a cancelled account-change check consumed the new account's reminder, and callbacks retained from an old modal could act on its replacement. Independent review then identified the asynchronous native-read window beneath the mocked root boundary; real-helper tests now cover its cancellation and deduplication.

Actual presentation was built through the saved React Native Web harness and inspected at 375 × 650, 430 × 780 and 320 × 360. At the shortest size the error increases content height; scrolling reaches both retry and Not now while the fixed close remains visible. Pending disables Enable, failure restores it, synthetic success closes, and dismissal during pending remains closed after the timer completes. Loaded heading font was verified as WashedUpDisplay-Semibold.

[Review](http://127.0.0.1:8843/notification-primer-review.html). Evidence and synthetic fixture source live in the design folder's `verification/notification-primer/`. Embedded iframe actions were unavailable through the browser tool; the same component was exercised directly using a temporary viewport override, which was reset afterward.

Browser evidence proves the presentation with synthetic outcomes, not the root/modal/native OS transition. Native VoiceOver/TalkBack, dynamic text, actual OS permission sheets, APNs registration and cross-device OneSignal delivery still need device verification. The saved server subscription-owner conflict and source-aware mute/reaction fanout remain separate work; this client patch does not solve those server contracts.
