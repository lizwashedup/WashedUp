# First-install store refresh — draft, not published

New App Store installations start from the source embedded in iOS 1.0.7 (51),
before a downloaded Expo update applies on a later launch. OTA publication does
not replace that embedded source. This candidate prepares 1.0.8 (52) with the
reviewed current app fixes and a pinned iOS navigation cleanup correction.

On November 3, App Store Connect showed 1.0.7 (51) as the live version and latest
completed upload, with no later version listed. Recheck before upload. The shared
app version becomes 1.0.8; Android versionCode stays 18. No Android binary is
prepared. Liz accepted Apple agreement 7MJ4WNXK5F; acceptance persisted after
reload. This account prerequisite is cleared.

## Source and native changes

Source baseline is main `974525a5d38d3f42c228b0e291175a0131859ccb`. Its full gate
41736949518 passed; version-reservation commit b374892 also passed gate
41753519079. Those runs exclude the later native patch and are not final acceptance.

The recorded Build 51 REACT-NATIVE-4X exception points to resetting navigation
controllers during Fabric recycling. The patch opts this controller-owning view
out of recycling and explicitly handles its own Delete notification in WillMount,
when the hierarchy is still attached. It flushes pending UIKit layout before
Fabric removes children, waits for active transition completion, cancels pending
interactive transitions, dismisses owned modals, clears delegates/parents and
child references, and rejects late callbacks that could reopen retired screens.
The pre-context interactive case only resets controllers when no coordinator
exists. Active transitions are not reset. Normal live-stack animations remain.

The exact react-native-screens 4.16.0 source and patch payload/output are hashed.
The native prebuild plugin refuses shared/out-of-project dependency symlinks and
unknown source/version drift. Loading Expo config for OTA does not mutate native
files. Patch/config inputs participate in Expo fingerprinting. Do not override a
native build's runtime with an OTA target. Build 51 scene protections remain.

## Verification and limits

- The initial baseline Release simulator build embedded current source: 754
  tracked source-map files matched. A fresh iPhone 13 / iOS 26.4 install reached
  welcome and email sign-in; the first loader record used the embedded manifest,
  with no downloaded update. This predates the final native patch/config and is
  not final artifact provenance.
- Native candidate 7 passed all 12 checks on iOS 17.5, 26.4 and 27.0. The actual
  full-Fabric shutdown case also passed independently on each runtime. Tests
  cover requested-but-not-started and active transitions, custom push,
  interactive pop, modal presentation/dismissal, late callbacks, parent/delegate
  cleanup, weak-reference release and ordinary modal open/close/reopen.
- A controlled comparison using the same corrected WillMount ordering failed
  two early-transition cases on candidate 5; candidate 7 passes both. Earlier
  fixtures had startup-window races, fixed-duration assumptions and an incorrect
  cleanup ordering. All earlier failure logs are retained. The tests now wait
  for native appearance/completion in settled states and assert real transitions
  in interruption tests.
- An investigated missing-custom-animation-completion path was not exercised by
  the failing trace. Its experimental subclass is excluded from this candidate.
- Seven native patch application guards pass. The checked-in native XCTest
  sources and preparation command are under `qa/native/screen-stack` and
  `scripts/native/prepare-screen-stack-tests.py`.
- The original production exception has **not** been reproduced. These results
  establish candidate cleanup behavior, not exact reproduction or fleet repair.
  The reported iOS 17 featured swipe issue remains unreproduced and unresolved.

Evidence and immutable test-app copies:
`/Users/liz/Desktop/WashedUp/Implementation/first-install-store-refresh-20261103/`.

## Remaining release gates

1. Full regression at the final source commit, exact source/config/dependency
   verification, and a local signed device archive with production environment.
2. Exact embedded source map and native dSYM processing; artifact-derived runtime,
   provisioning, signatures and new OTA target registration without weakening
   existing iOS 51 / Android 18 guards.
3. Native physical-device acceptance. Simulator tests do not substitute for it.
4. Clean-install signup → first Plans visit, featured horizontal swipes, vertical
   scroll, detail/back, subsequent launches, and slow/offline update checks on
   supported phone/tablet environments. Preserve embedded offline startup.
5. Existing rollback, backend canary, store submission and post-release checks.

Do not merge or submit merely because simulator checks pass. Unmerged broad
refactor/moderation work and the private redesign are excluded. No cloud build,
upload, App Review submission, OTA publication or production data change has
occurred in this preparation.

Future reports must distinguish OTA availability, confirmed device adoption and
code available on a fresh store installation. The store refresh addresses the
confirmed delivery gap; it is not a demonstrated featured-swipe repair.
