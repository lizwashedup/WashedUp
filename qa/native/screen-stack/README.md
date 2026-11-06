# Native screen-stack release checks

These XCTest sources execute native UIKit/RNS transitions inside an independent
copy of the Release simulator app. They do not sign in, create plans, or publish
updates. They are a release gate, not proof that a reported production exception
has been reproduced. The app's native retirement candidate remains experimental.

Prepare a completed arm64 simulator artifact with
`scripts/native/prepare-screen-stack-tests.py --app <absolute-app-path> --binary-sha256 <reviewed-executable-sha256> --output <new-absolute-evidence-directory>`.
The preparation refuses device artifacts, unexpected identity, a different binary,
and existing output. It verifies every copied app file before injecting XCTest,
and records input/test-source hashes. The original app is untouched. Run this
on a dedicated simulator; never erase or reuse another chat's active device.

Use `xcodebuild test-without-building -xctestrun <output>/screen-stack.xctestrun
-destination 'platform=iOS Simulator,id=<dedicated-uuid>'
-parallel-testing-enabled NO -resultBundlePath <new-result-path>` with explicit
`-only-testing:ScreenStackLifecycleTests/<class>/<method>` selection. Keep logs
and results, including failures. Do not repeatedly run until a passing result is
found and discard the failures.

Required classes:

- `ScreenStackActiveNavigationTests`: actual app root readiness, ordinary modal
  open/close/reopen, completed transitions, then fixture cleanup.
- `ScreenStackNavigationRetirementTests`: deletion during push and interactive
  pop, including the requested-but-not-started context and custom animation.
- `ScreenStackRetirementTests`: recycling opt-out, modal presentation, presented
  modal, dismissal, late callbacks, parent detach and weak-reference release.
- `ScreenStackLifecycleTests/testFullFabricShutdownDuringAuthLinkTransition`:
  actual mounted app, observed auth-link transition, then the termination
  notification consumed by RCTSurfacePresenter. All stacks must retire and
  navigation controllers must deallocate.

Run both the combined suite and the full-Fabric method in its own process. The
latter must not depend on a previous fixture changing the app's window state.
Wait for actual appearance/completion in settled-state checks; keep deliberately
interrupted transition checks explicit. Assert that the transition under test
really started. A skipped/absent transition is not a passing interruption test.

Build inputs, source maps, test source hashes, runtime/device IDs and outcomes
belong with the release evidence. A signed physical-device build still needs its
own acceptance checks. Simulator coverage does not substitute for that check or
for clean-install signup, featured swipes, offline startup and final artifact
runtime/signature verification.
