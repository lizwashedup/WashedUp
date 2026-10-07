# Chat locations, voice and room lifetime — isolated package

September 13, 2026. This continues the approved chat redesign with existing useful controls, rather than adding a custom emoji keyboard or another messaging feature. Ordinary mobile emoji entry uses the phone keyboard; message reactions remain separate.

## What changed

- **Location messages:** Plan/Circle/DM, main-community and topic adapters use one opt-in `ChatLocationPreview`. A readable address, pin and map action fit inside the existing bubble. Long addresses take up to three lines; the full label remains on the accessible map action. The shared component makes no map or geocoding requests. Existing adapters retain map destinations, message actions and their distinct stored formats.
- **Invalid locations:** legacy Plan JSON is validated before opening Maps. A malformed or absent coordinate no longer silently becomes zero. Real numeric `(0, 0)` remains valid. Numeric range/finite checks are shared with topic rendering. This does not rewrite any saved message.
- **Location lookup:** the current-location picker has a 15-second GPS wait and a 5-second address wait after permission. Address failure keeps the exact pin with a coordinate label. The OS permission prompt itself remains untimed. Returning from Settings rechecks only after this visible visit explicitly opened Settings; ordinary foregrounding does not request a location or send anything. An uncertain send keeps the pin and avoids falsely claiming it was not delivered.
- **Voice:** the staged player and recording draft use the approved tokens, compact play/seek/speed controls and an elapsed/total clock. The progress rail reflects playback; it is not a fabricated waveform. Replay waits for seek, loading and failed operations have recovery, and retired players cannot complete an old replay in a new visit. Existing recording metering, draft retention and speed choices remain. Browser QA found and repaired missing ARIA position values; keyboard seeking now works in the web component too.
- **Room lifetime:** shared-chat member menus and delayed report/block callbacks retain the initiating room/account. Block calls receive the existing readable scope, and stale success callbacks cannot navigate the replacement room. Reaction callbacks retain the writable scope. Reporting/blocking in expired chats remains available under the existing policy.
- **Presence and typing:** Plan presence writes coordinate overlapping local visits without an old cleanup clearing the new room. Typing callbacks and peer state retire with their room/account. Channel names, payloads, timing and the existing Plan-only presence column remain unchanged.

No dependency installation, production build, database migration, provider configuration or real communication was performed. The preserved TestFlight source and existing uncommitted work remain intact. Appearance stays behind the local development gate; bottom navigation is unchanged.

## Verification

**260 targeted tests in 14 unique suites pass.** The root integration run covers 243 tests in 13 suites, and the final player suite adds 17. These render actual components/hooks with controlled transport/native boundaries; they are not evidence of production delivery. Full TypeScript and scoped diff checks pass.

Root logs:

- `/private/tmp/washedup-special-messages-tests.log`
- `/private/tmp/washedup-special-messages-voice-tests.log`
- `/private/tmp/washedup-special-messages-tsc.log`

The affected integration suites include shared ChatThread entry/media, main/topic entry and location rendering, the location picker, recorder, presence, typing, scoped blocking, shared chat ownership/refresh, and location parsing. Regression tests preserve exact zero coordinates and original map URLs, late account/room callbacks, expired-chat moderation, GPS/address deadlines, Settings intent, playback replay/retry and accessible seeking.

## Visual evidence

The local review at `http://127.0.0.1:8845/?view=special-messages` renders the real location, player and recorder components with sample data and a generated one-second silent WAV. It is a component fixture, not the full conversation screen. Its send/failure controls affect local fixture state only. It does not request microphone/location permissions or contact a map/message provider.

The 375×812 and 430×932 checks cover normal and long location labels, outgoing/incoming colors, unclipped playback controls, draft sending/retention and return from a simulated unconfirmed send. Message wrappers use maximum widths rather than fixed card widths. Browser playback reached the end; Home/End seeking and speed changes were observed. Slider values now expose the actual elapsed/total position instead of the browser's default value. Seek and primary playback targets measured 44 points high.

Screenshots and the local fixture source are saved under:

`/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/chat-special-messages/`

## Remaining work and limits

- `ReportModal`'s internal already-submitted request still needs its own captured account/attempt scope. A guarded parent callback alone cannot protect the internal `getUser` → insert sequence. The delayed parent Circle/DM menu is another explicitly recorded boundary. Do not describe all moderation paths as finished.
- Existing profile-column presence is not a server TTL or cross-device solution. Already-dispatched remote writes cannot be recalled. These tests do not prove push suppression/delivery or every expired-session cleanup.
- Physical-device playback, interruption/audio routing, VoiceOver/Dynamic Type, keyboard, long-history scrolling, reconnect and background return remain. The browser fixture does not establish smooth native chat performance.
- Current location sharing sends one confirmed GPS pin. Manual place search and event meeting-point selection remain later design/source decisions; this package does not introduce a new provider or live tracking.
- Existing Intros/main metadata, separate read positions, compatibility mapping and OneSignal fanout still need an isolated database rehearsal before grouping can be released.

Next: connect the staged full conversation for integrated review, close the remaining report/menu lifetime boundaries, and run the device matrix. Continue the remaining app design in stages using the accepted type/color system.

## Detailed source evidence

- [Location wait and Settings recovery](location-picker-wait-recovery-2026-09-13.md)
- [Voice API, reference research and playback tests](voice-player-2026-09-13.md)
- [Presence/typing ownership and remaining boundaries](shared-chat-presence-and-typing-2026-09-13.md)
- [Earlier entry/media transport and recorder package](shared-chat-entry-media-2026-09-13.md)
