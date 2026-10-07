# Voice message playback: staged appearance and operation lifetime

This isolated package improves the existing voice-message player and recording-draft preview. It changes no audio schema, upload, provider, message identity, or access gate. Root integrates its optional appearance into the development-gated ChatThread and VoiceRecorder callers.

## Interface and behavior

`VoicePlayer` keeps `uri`, `durationSeconds`, and `isOwn`. Its only added prop is `appearance?: { fonts: AfterglowFontFamilies }`.

- Replay awaits the existing `seekTo(0)` Promise before invoking play. A synchronous operation lock suppresses duplicate replay/seek/speed attempts. A player/URI visit guard retires pending completions on replacement or unmount.
- Ready status must belong to the current player. Loading holds playback; an explicit native failed state or thrown operation presents Retry. Loading longer than 15 seconds says “Taking longer to load.” This is a recoverable wait indication, not proof the recording is missing.
- Retry pauses and uses the installed player's existing `replace(uri)` API. It waits for a fresh status instead of accepting the pre-reload loaded status, does not automatically start playback, and can itself be retried after a synchronous failure.
- The existing 1x → 1.5x → 2x choices remain. A failed native rate change does not falsely update the displayed choice. Tapping the progress area seeks within the actual duration; accessibility increment/decrement actions move five seconds within the same bounds. Explicit ARIA position values avoid RN-web's otherwise unlabelled slider midpoint. Web arrow keys move five seconds, Home/End move to the recording's boundaries, and unrelated shortcuts remain untouched.
- Staged appearance uses the accepted font families and Afterglow color/type constants, an honest elapsed/total clock, a simple progress rail, and 44-point play/speed controls and seek height. Its container relinquishes the legacy 200-point minimum. Status copy can wrap. Legacy callers retain the existing type/color/bar layout; the loading/error/lifetime repairs apply to both appearances.
- Legacy seeded bars remain explicitly decorative. They do not contain recorded amplitude. The staged rail reflects the actual playback clock; it does not pretend to be waveform data.

## Source-backed decisions

The installed package is `expo-audio` 1.1.1. Read-only inspection found:

- `node_modules/expo-audio/src/AudioModule.types.ts`: play, pause, replace and rate changes are void; `seekTo` is asynchronous. The player exposes `isLoaded`.
- `node_modules/expo-audio/src/Audio.types.ts`: status exposes player id, loaded/buffering/playing/time fields and playbackState. It has no universal cross-platform error field.
- `node_modules/expo-audio/src/ExpoAudio.ts`: `useAudioPlayer` owns/replaces/releases the shared player; this component does not add a separate release lifecycle.
- `node_modules/expo-audio/src/AudioModule.web.ts`: the status helper can initially report loaded while the player's own `isLoaded` is false. The player therefore checks both on web. `replace()` can resume a playing source, which is why retry pauses first. Web `play()` does not return the media element's rejected Promise to its caller; this component cannot promise to catch every browser playback rejection through that API.
- `node_modules/expo-audio/ios/StringConversions.swift`: a failed native player can expose `playbackState: 'failed'`. Android has different playback-state strings; this component does not invent a universal error event.

The official [WhatsApp voice-message reference](https://blog.whatsapp.com/making-voice-messages-better?lang=fil) describes draft preview and 1.5x/2x listening. These support retaining useful existing controls while improving their behavior. It is a comparison reference, not evidence that our app matches WhatsApp's reliability. The [Apple Playing audio HIG](https://developer.apple.com/design/human-interface-guidelines/playing-audio) was located, but its JavaScript-only response was not enough to independently inspect the complete guidance in this pass.

## Reproduction and verification

Before the repair, the first eight actual-component cases produced seven failures and one preservation pass. Evidence is saved at `/private/tmp/voice-player-baseline.log`. Failures included playing before replay seek completed, duplicate replay, obsolete replay after URI change, rejected seek still playing, no loading hold/retry, and an unconfirmed displayed speed.

The final player suite has 17 passing cases. Additional cases exercise touch and accessibility seeking, replacement of the player with the same URI, unmount, replace failure then retry, stale loaded status during reload, late status from a previous player, decorative legacy bars versus the staged progress rail, explicit ARIA values, and web keyboard seeking. Root's actual browser review found the missing ARIA values after the first pass; these final two cases accompany that correction.

The relevant player, recorder and ChatThread component suites pass together: **64 tests in four suites** at the time of this handoff. Some ChatThread tests belong to concurrent root work; the owned player suite is 17 cases.

```sh
./node_modules/.bin/jest --runInBand --ci \
  --cacheDirectory=/private/tmp/washedup-voice-player-jest \
  components/chat/__tests__/VoicePlayer.test.tsx \
  components/chat/__tests__/VoiceRecorder.sending.test.tsx \
  components/chat/__tests__/ChatThreadEntryLifetime.test.tsx \
  components/chat/__tests__/ChatThreadComposerMedia.test.tsx
```

These tests render the actual component with deferred/mocked audio API calls. They establish UI and operation ownership; they do not establish real speaker output, remote-media decoding, background/audio-route handling, physical VoiceOver, native large-text layout, or network recovery on devices. Root owns final combined typecheck and visual QA. No dependency or production changes were made.

## Owned files

- `components/chat/VoicePlayer.tsx`
- `components/chat/__tests__/VoicePlayer.test.tsx`
- This document.
