# Shared conversation composer accessibility — September 13, 2026

The actual Plan/Circle/DM `ChatThread` send/voice morph was a `GestureDetector` around an animated view, with no button role, accessible name or accessible/keyboard activation. Reply and edit cancel icons also had no labels and only small icon bounds with hit slop. Five actual-component baseline checks reproduced those missing controls before this bounded repair.

Only `components/chat/ChatThread.tsx` composer activation, reply/edit cancel properties and their narrow style were changed. Existing parent, report, media, transport, recording-scope and message work is preserved.

## Behavior

The morph is one named button: “Send message”, “Save edit” for a nonempty edit, or “Record voice message”. Native accessibility activation and web Enter/Space invoke the existing owned composer callback. Repeated held keys are ignored; ordinary web pointer taps stay with the original gesture handler, while a screen reader's synthesized click has an accessible activation path. Under the recording controls, the underlying morph is hidden from accessibility and removed from keyboard tab order.

Nonempty text uses the existing `handleSend`, including its synchronous lock, reply/edit identity, draft recovery and operation scope. Empty accessible activation calls `beginRecording('locked')`. This is the same recorder start and scope, with a different initial UI mode so existing pause, stop/preview, discard and send controls are available without a physical hold. The initial activation never stops, uploads or sends audio. Duplicate activation while preparation is pending is blocked by the existing synchronous capture ref. Permission rejection uses the existing recovery.

The physical gesture still calls `beginRecording()` with the default `holding` mode. Its long-press threshold, exclusive tap/pan composition, swipe lock/cancel thresholds and release-to-send path are unchanged. Empty ordinary taps remain the existing no-op/haptic hint. Existing recording operations, UUID/receipt recovery, transports and expiry/admission/account gates are unchanged.

Reply/edit cancel buttons now have explicit labels and a minimum 44 × 44 target without expanded overlapping hit slop. Cancel reply keeps the typed draft; cancel edit keeps the existing clearing behavior. Their existing guarded callbacks and revision updates are unchanged. These are narrow accessibility fixes in both appearances; the accepted staged fonts, colors and media behavior remain intact.

## Verification

20 tests in `components/chat/__tests__/ChatThreadComposerAccessibility.test.tsx` exercise the actual `ChatThread` with mocked recording, transport and gesture boundaries. They cover native VoiceOver-style activation and Android activate action, web keys and synthesized click, text duplicate lock, reply/edit labels and target dimensions, explicit stop/preview/send, permission rejection, pending preparation duplicates, retired room/account/closed callbacks, delayed preparation, retained cancel, and physical hold/lock/release/cancel in staged and legacy appearances. No microphone or real sends occur.

The new suite plus existing `ChatThreadComposerMedia` and `VoiceRecorder.sending` suites passed **33 tests in 3 suites**. Full TypeScript and scoped whitespace checks passed:

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-composer-accessibility-agent-jest components/chat/__tests__/ChatThreadComposerAccessibility.test.tsx components/chat/__tests__/ChatThreadComposerMedia.test.tsx components/chat/__tests__/VoiceRecorder.sending.test.tsx
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-composer-accessibility-agent.tsbuildinfo
git diff --check -- components/chat/ChatThread.tsx components/chat/__tests__/ChatThreadComposerAccessibility.test.tsx
```

Root separately owns the full conversation browser fixture and combined entry regressions. This package does not claim device VoiceOver/TalkBack, physical microphone permission/recording, keyboard-to-recording focus movement, or delivery verification. Those remain native-device checks; no dependencies, providers, schema or session flows changed.
