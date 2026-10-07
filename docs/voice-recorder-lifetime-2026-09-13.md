# Voice recorder visit ownership — September 13, 2026

## Scope

This isolated change covers `hooks/useVoiceRecorder.ts` and actual-hook tests in `hooks/__tests__/useVoiceRecorder.lifetime.test.tsx`. It does not publish an app, contact an audio service, install dependencies, or access a real microphone. Chat gesture handlers, attachment upload, and cross-screen delivery remain caller responsibilities.

The hook accepts an optional `VoiceRecorderScope` with `isCurrent(): boolean`. Callers keep that object stable during one writable room/account visit and retire it permanently when the visit ends. Existing scope-free callers remain supported.

## Reproduced failures

The first controlled native-mock run failed 13 of 16 tests. Pending permission and recorder preparation could start recording after cancellation, unmount, or a room/account change. Duplicate starts and stops overlapped native operations. An old stop could return a clip after cancellation, reset a newer recording, or disable recording mode while the replacement operation was preparing.

The pre-repair output is `/private/tmp/washedup-voice-before.log`.

## Repair

Each attempt owns its initiating visit and a synchronous phase. Pending start, stop, pause, and resume operations cannot be duplicated. Cancellation retires local intent immediately. Every deferred permission, audio-mode, preparation, stop, and cleanup completion checks that ownership before starting native work or delivering a clip.

Native preparation, stopping, and audio-mode changes share a per-hook queue. A new attempt may wait while an old native call settles, but cannot prepare the same recorder until its previous cleanup completes. Cleanup targets only the owning attempt, so an old cancellation cannot stop the replacement recorder or clear its UI state. A stop result is released only after cleanup and a final ownership check.

The existing high-quality m4a/AAC preset, recording controls and return shapes, amplitude normalization, 48-sample waveform cap, emission throttle, and rounded minimum-one-second duration are preserved. Paused recordings receive cleanup even when native state says `isRecording: false`.

## Verification

The final actual-hook suite passes **23/23 tests**, covering stale permission/audio-mode/preparation, cancellation, scope retirement, unmount, duplicate controls, delayed stop and audio-mode release, stale errors, recovery after preparation failure, paused cleanup, scope-free positive behavior, exact clip payload, and waveform/duration preservation.

Command: `npm test -- --runInBand --cacheDirectory=/private/tmp/washedup-voice-jest hooks/__tests__/useVoiceRecorder.lifetime.test.tsx`

Output: `/private/tmp/washedup-voice-after.log`.

`npm run typecheck` also passed; output is `/private/tmp/washedup-voice-tsc.log`. The installed dependency symlink remains unchanged.

## Boundaries

Native permission and audio preparation promises cannot be physically canceled by this hook. Retired results are ignored and acquired native resources are cleaned up once those promises settle. An indefinitely pending native operation keeps replacement preparation waiting; no unproven timeout or forced parallel recorder reset was introduced.

The queue is per hook/recorder instance. Coordination of the platform-wide audio session across independently mounted hook instances is not established by these mocked tests. Physical-device microphone permission, interruption, backgrounding, audio playback interaction, and OS cleanup behavior still require device verification.
