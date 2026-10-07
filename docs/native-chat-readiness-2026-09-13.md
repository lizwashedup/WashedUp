# Native chat verification readiness

## September 13 evening — native launch observed

The earlier Simulator UI block cleared. The parent opened the installed isolated `com.washedup.localdev` development build through Simulator UI, entered localhost:8846, and observed the actual staged ChatThread. The fixture identified itself as “Native fixture · Nothing live · Mona loaded.” No production app or release was used.

Observed in this iOS simulator session:

- Compact event context, member identities, messages, quoted reply, reaction chips and a shared location card rendered with the staged fonts/colors.
- Entering “Native preview message” in the native composer and pressing Send appended a local bubble and reset the composer.
- The iOS software keyboard was shown through Simulator’s Keyboard menu. The composer and latest message remained above it, with event context still accessible.
- Accessibility output exposed event/calendar/profile/reaction/send labels. This is not a full VoiceOver traversal.

Send-retry was opened and a draft entered, but a failed-send receipt and successful retry were **not** verified on native. At the next inspection Simulator was showing Safari instead, so the parent did not overwrite that changed surface. Load retry, expired/read-only behavior, gestures, large text, background return, reconnect and physical-device performance remain open. Earlier successful browser and automated checks do not substitute for these native observations.

This local fixture uses simulated transport and identity. It cannot establish production authentication, message persistence, notifications, actual media upload or delivery. The historical preparation notes below explain the recovered binary and containment; their old “launch unconfirmed” wording describes that earlier phase only.

## Earlier preparation record

Current state: the parent task successfully installed the isolated `com.washedup.localdev` app on the booted iPhone 17 Pro Max simulator running iOS 26.4, device `6DBCB4BE-3283-4B8A-9F6A-8A83F74CF802`. The localhost:8846 `/status` endpoint returned HTTP 200. Native app launch and `ChatThread` rendering are not confirmed.

Simulator Safari reached “Open this page in WashedUp?” after the parent entered the local fixture deep link through the available computer-use tool. Accessibility output omitted the confirmation buttons, and coordinate clicks failed with `noWindowsAvailable`, including after reacquiring `com.apple.iphonesimulator`. This is a simulator UI tooling block, not evidence of an app runtime failure. No alternative UI or command-line launch bypass was attempted. The candidate and local server remain available; the parent owns any further launch attempt.

Read-only inventory found an existing isolated native simulator binary, so a new prebuild, dependency install or cloud build is not the shortest next step.

The reusable product is `/Users/liz/Documents/Codex/WashedUp-Takeover-2026-09-10/build/ios-simulator/Build/Products/Debug-iphonesimulator/WashedUpLocal.app`: `com.washedup.localdev`, version 1.0.6/build 44, arm64+x86_64 simulator support, Expo development launcher, updates disabled and no remote update URL. Its saved build log ends `BUILD SUCCEEDED`. The original build-source dependency declarations match the current isolated checkout. The current checkout itself has no `ios`, `android`, or `.expo` native build output.

At the initial read-only inspection, all available simulators were shut down; iOS 26.4 and 26.5 runtimes are installed. Six installed WashedUp app copies were found, all using `com.washedup.app` and remote update checks. None was launched, changed, or treated as an isolated preview. The saved localdev build was not then installed; the parent subsequently completed its installation as recorded above.

The existing browser harness uses React Native Web plus `window`/`document` and is not directly native-safe. A separate temporary native candidate was prepared at `/private/tmp/washedup-native-chat-review`, using the actual current `ChatThread` and font hook without the app `_layout`/auth bootstrap. It registers Expo's `main` component, uses native SafeArea/Gesture roots, local fixture messages and memory-only transport/identity/storage, and explicitly disables production boundaries, provider media, uploads, permission prompts, external links and recording. It does not change implementation source or existing build artifacts.

Verification performed before simulator launch:

- Native iOS manifest: HTTP 200, localdev identity, updates disabled, launch URL on localhost:8846.
- Complete iOS/Hermes-requested development bundle: HTTP 200, 3,150 modules, approximately 14.1 MB.
- Exact Expo native font URL: HTTP 200, 109,012-byte local Mona Regular asset.
- Fixture no-emit TypeScript: passes, including imported current implementation.
- Existing binary architectures: arm64 and x86_64.
- Existing binary signature check: unsigned. The parent subsequently installed it successfully without re-signing or altering the artifact. Native runtime initialization remains unverified.

The server starts with `sh /private/tmp/washedup-native-chat-review/start.sh`. It uses `EXPO_OFFLINE=1`, no telemetry, no dotenv and localhost:8846. Sandbox loopback binding returned `EPERM`, so the local server/read checks used the approved escalated path. CI mode requires a server restart after source changes to avoid stale bundles.

The fixture source/configuration and README are also saved in `Design/Shared Experience - Round 1/verification/native-chat-readiness/` for recovery if temporary files are cleared. Restore them to the documented temporary path and reuse the existing dependency symlink; the saved start script deliberately names that path.

The remaining step is to complete the local development launch on the already installed isolated app and observe the actual screen. It is presently blocked at Safari's confirmation through the available UI tool. Do not bypass that block with another UI technology or command-line launch. The exact fixture URL, containment boundaries and native review cases are recorded in `/private/tmp/washedup-native-chat-review/README.md`. No simulator/device/account state was changed by the preparation task; subsequent parent installation is recorded separately above.

Compilation and successful installation are not native runtime verification. Native launch, actual font rendering, keyboard/insets, gestures, scrolling and accessibility still need observation. A simulator fixture cannot establish real notification delivery, production auth/data behavior, hardware microphone behavior or physical-device performance. Those remain separate checks.
