/**
 * iOS Podfile patch: AppCheckCore (pulled in by @react-native-google-signin) is a
 * Swift pod that needs modular headers from its non-modular transitive pods
 * (GoogleUtilities, RecaptchaInterop), or `pod install` fails with
 * "needs to be built as a Swift module / requires modular headers".
 *
 * This was previously fixed by hand-editing ios/Podfile, but ios/ is gitignored
 * and EAS regenerates it on every prebuild, so the patch was lost in the cloud
 * build (Install pods phase failure). This config plugin re-applies it during
 * prebuild so it survives on EAS. Idempotent: it no-ops if the lines are present.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const INJECT =
  "\n  # AppCheckCore (via @react-native-google-signin) is a Swift pod that needs\n" +
  "  # modular headers from these non-modular transitive pods. Re-applied here\n" +
  "  # because ios/ is gitignored and EAS regenerates the Podfile on prebuild.\n" +
  "  pod 'GoogleUtilities', :modular_headers => true\n" +
  "  pod 'RecaptchaInterop', :modular_headers => true\n";

module.exports = function withIosModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes("pod 'GoogleUtilities', :modular_headers")) {
        // Inject right after the main target's `use_expo_modules!` line.
        contents = contents.replace(
          /(\n[ \t]*use_expo_modules!\s*\n)/,
          `$1${INJECT}`,
        );
        fs.writeFileSync(podfile, contents, 'utf8');
      }
      return cfg;
    },
  ]);
};
