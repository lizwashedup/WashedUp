# First-install store refresh — release candidate, not published

New App Store installations currently start from the source embedded in iOS
1.0.7 (51), before a downloaded Expo update applies on a later launch. Publishing
an OTA does not change that embedded source. This candidate reserves 1.0.8 (52)
for a local native build containing the reviewed current app fixes.

On November 3, App Store Connect showed 1.0.7 (51) as the live version and latest
completed upload, with no later version listed. The proposed numbers are therefore
available at that checkpoint; recheck before upload. The shared app version changes
to 1.0.8, but Android versionCode stays 18 and no Android release is prepared here.

## Verified preparation

- Source baseline: main `974525a5d38d3f42c228b0e291175a0131859ccb`.
  Its full regression run, GitHub Actions `41736949518`, passed. This is source
  regression evidence, not acceptance of a new native artifact.
- An isolated Release simulator build with the two version fields above compiled.
  Source-map contents matched 754 tracked source files, including recent signup
  and profile photo fixes. Generated binary-asset modules were excluded from
  raw source-file hashing. Existing Build 51 scene protections were preserved.
- A newly created iPhone 13 / iOS 26.4 simulator reached phone welcome and alternate
  email sign-in without authentication. Its first Expo loader record matched the
  embedded manifest, with one successful and zero failed launches. No remote
  replacement update was available or downloaded.
- Native transition probes on iOS 26.4 and 27.0 have not reproduced the recorded
  teardown crash. Passing those probes does not establish a repair.

Local evidence, build inputs and logs:
`/Users/liz/Desktop/WashedUp/Implementation/first-install-store-refresh-20261103/`.
These are simulator artifacts, not a signed device archive or submitted build.

## Release holds

1. Resolve and validate the Build 51 `REACT-NATIVE-4X` navigation teardown issue
   recorded in `/Users/liz/Desktop/WashedUp/NEXT-NATIVE-BUILD.md`. No native patch
   or dependency upgrade is included in this version reservation. A standalone
   recycling opt-out skips controller/modal cleanup and is not an accepted fix.
2. Complete fresh-install signup, first Plans visit, horizontal featured swipes,
   vertical scrolling, detail/back, subsequent launches and slow/offline update
   checks on supported phone/tablet environments. Reported iOS 17 swipe behavior
   remains unverified; newer-simulator results are not iOS 17 coverage.
3. Apple currently requires the account holder to review and accept the updated
   Developer Program License Agreement before submission. Acceptance must be
   verified in the account; opening the agreement is not acceptance.
4. Run the full final-source release gate; build locally with production environment
   parity; verify signatures, provisioning, exact source maps/dSYMs and the runtime
   derived from the final device artifact. Never apply an OTA runtime override to
   a native build. Preserve scene lifecycle and offline embedded fallback.
5. Register and verify the new signed artifact's OTA target without weakening the
   existing iOS 51 / Android 18 guards. Complete physical-device acceptance and
   the existing rollback, backend canary and post-release verification process.

Do not merge or submit this candidate merely because the version reservation or
simulator build passes. Unmerged broad refactor/moderation work and the private
redesign are excluded. No OTA publication, production data changes, cloud build,
upload or App Review submission is part of this preparation.

Future release reports must distinguish OTA availability, confirmed device
adoption and the code available on a fresh store installation. A store refresh
fixes the confirmed delivery gap; it is not a demonstrated fix for the reported
featured-card swipe failure.
