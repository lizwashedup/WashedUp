# Shared chat entry, attachments and recording — September 13, 2026

Isolated native implementation candidate. This package covers the actual `ChatThread` used by Plan and Circle conversations, including Circle-backed direct messages. It builds on the accepted native-keyboard simplification. No new messaging service, custom emoji typing keyboard, recipient rule, database migration or release was added.

## Problems reproduced

The original component accepted delayed picker/upload/recording results after a room, account or write-permission transition. An old account visit could still hold an attachment lock on return. A pending send could also clear a newly selected reply/edit. A failed earlier text send could be inserted into an unrelated existing-message edit. Voice recording UI discarded the recording before delivery was confirmed.

The initial actual-screen regression set reproduced ten failures in twelve cases; two positive cases protected same-context draft restoration and partial-photo retry/caption behavior. The transport, native location picker and recording hook have their own before/after evidence linked below.

## Implemented behavior

- A committed room/account entry owns all composer continuations. A separate writable visit retires sends and attachments when the existing admission/expiry gate closes. Returning to the same IDs creates a new visit rather than reviving old callbacks.
- Text, photo, GIF, location and voice actions acquire immediate attempt locks. A retired result cannot start the next preparation/send step, change the replacement room, display its old error or unlock a newer attempt.
- The component passes the captured scope to the existing transport. Photos keep the original message UUID, confirmed upload and once-only caption behavior across partial-batch retries. A stale picker cannot create a preview in another conversation.
- A late send completion preserves the newer reply/edit context. An unconfirmed earlier message is not prepended into a different edit; it remains available in a selectable, scrollable recovery dialog with a copy action. The dialog says confirmation is unknown, since an interrupted receipt is not proof that the server rejected a message.
- Voice recording retains its existing hold, lock, pause, cancel and preview controls. The upload/send stage keeps the recording visible, shows a pending indicator and blocks duplicate taps. An explicit retry reuses its confirmed upload URL and original message UUID. Only matching delivery confirmation clears the clip.
- The recorder serializes native preparation/stop/audio-mode cleanup per recorder instance and retires canceled or previous-entry work. Audio upload checks its initiating scope before/after file and storage work. Existing storage format/path and message fields remain.
- The location modal protects each opening and its permission/GPS/address/confirmation operations. Latitude, longitude and address stay attached to the same selected snapshot. This preserves the current one-pin feature; it does not introduce a search provider or live-location feature.

## Modified surfaces

`components/chat/ChatThread.tsx`, `VoiceRecorder.tsx`, `LocationPickerModal.tsx`, `components/BrandedAlert.tsx`, `hooks/useChat.ts`, `hooks/useVoiceRecorder.ts`, and `lib/uploadAudio.ts`, plus targeted tests. The alert's optional scroll mode leaves existing alert layouts unchanged. Existing uncommitted work elsewhere in this checkout is outside this package.

## Validation and companion evidence

- [Transport ownership and exact receipt contract](shared-chat-operation-scope-2026-09-13.md)
- [Location picker lifetime](location-picker-lifetime-2026-09-13.md)
- [Native recorder lifetime](voice-recorder-lifetime-2026-09-13.md)
- [Native keyboard and media decision](chat-media-panel-2026-09-13.md)

Final combined regression run: **149 tests across 15 suites pass**, including 34 transport ownership, 19 refresh/history, 17 actual entry, 11 composer/media, 18 location, 23 recorder-hook, 5 audio upload, 2 voice pending UI, 4 alert, and existing paging/session/receipt/UX contracts. The one intermediate alert failure was a test selector mismatch for the React Native Pressable mock; the prop-based selector was corrected and the full set rerun. Full no-emit TypeScript check passes and scoped diff checks are clean. The only subsequent source edit adds a rejected-clipboard-promise catch; the final component/transport suite includes that source.

The local Metro component bundle rebuilt successfully. Browser verification used actual VoiceRecorder and BrandedAlert components at 375/430 widths: pending controls disabled, local failed result retains the clip, local confirmation clears it, full recovery text reaches its final paragraph while Close stays fixed and reachable. At 430 width there is no horizontal overflow. The sample controls simulate delivery states; actual transport/entry state transitions are covered separately by the tests. The sample WAV is locally generated silence and does not access the microphone, GPS or a provider.

Visual evidence: `Design/Shared Experience - Round 1/verification/shared-chat-entry/375-voice-pending.png`, `375-long-message-end.png`, `430-voice-pending.png`, and `430-media-simplified.png`. The in-app browser's scaled capture was unreliable, so visual proof used Chrome; temporary viewports and QA tabs were cleaned up. The local `?view=media` review now explains the native phone keyboard decision and shows actual attachment controls. It no longer presents the old custom emoji panel as the mobile recommendation. `?view=voice-retry` is a component QA fixture, not a new product screen or final full-chat design.

## Practical limits and next checks

These are local tests using synthetic, controlled promises. They do not establish smooth physical-device performance, microphone/keyboard gestures, camera/GPS permissions, background return, operating-system interruption or notification delivery. Writes and native operations already dispatched cannot be recalled by client scope guards. Unknown storage completion can still leave an orphan upload; the confirmed URL is cached only after success. Native audio-session handoff across separately mounted recorders is not proven by the per-recorder queue.

Draft preservation is within the current entry, not durable across process termination. GIF and location sends do not gain a persisted outbox from this work. Location timeout/settings-return behavior, moderation/presence callback lifetimes, remaining special-message presentation and device testing are separate next actions. Existing server preservation and notification work remains held for its own isolated transition checks.
