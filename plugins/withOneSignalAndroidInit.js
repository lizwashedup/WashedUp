// Expo config plugin: inject `OneSignal.initWithContext(this, APP_ID)` into
// MainApplication.onCreate() at prebuild time.
//
// Why: onesignal-expo-plugin only injects Android resources (icons, sounds,
// colors) and never touches MainApplication.kt. Per OneSignal Android SDK
// docs, initWithContext must run in Application.onCreate() so the native SDK
// is ready when Android wakes a notification receiver on cold pushes. Without
// it, low-end Android devices throw
// `IllegalStateException: Must call 'initWithContext' before use`
// (Sentry REACT-NATIVE-5, 16 events / 5 users on SM-A165M).
//
// The JS-side OneSignal.initialize(appId) in hooks/usePushNotifications.ts
// still runs and is the source of truth for the app id; this plugin's call
// pre-warms the native context so the SDK doesn't throw before JS boots.

const { withMainApplication } = require('@expo/config-plugins');

const MARKER = '// WashedUp: OneSignal native init (injected by withOneSignalAndroidInit)';

const IMPORTS_BLOCK = `import com.onesignal.OneSignal
import com.onesignal.debug.LogLevel
`;

function buildInitBlock(appId) {
  return `    ${MARKER}
    OneSignal.Debug.logLevel = if (BuildConfig.DEBUG) LogLevel.VERBOSE else LogLevel.WARN
    OneSignal.initWithContext(this, "${appId}")
`;
}

function injectImports(contents) {
  if (contents.includes('import com.onesignal.OneSignal')) return contents;
  const anchor = /(import com\.facebook\.react\.defaults\.DefaultReactNativeHost\r?\n)/;
  if (!anchor.test(contents)) {
    throw new Error(
      'withOneSignalAndroidInit: could not find the DefaultReactNativeHost import to anchor OneSignal imports.',
    );
  }
  return contents.replace(anchor, `$1\n${IMPORTS_BLOCK}`);
}

function injectInit(contents, appId) {
  if (contents.includes(MARKER)) return contents;
  const anchor = /(override fun onCreate\(\) \{\r?\n\s*super\.onCreate\(\)\r?\n)/;
  if (!anchor.test(contents)) {
    throw new Error(
      'withOneSignalAndroidInit: could not find `override fun onCreate() { super.onCreate() }` to anchor the OneSignal init block.',
    );
  }
  return contents.replace(anchor, `$1${buildInitBlock(appId)}`);
}

const withOneSignalAndroidInit = (config, props) => {
  const appId =
    (props && props.appId) ||
    process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ||
    process.env.ONESIGNAL_APP_ID;

  if (!appId) {
    throw new Error(
      'withOneSignalAndroidInit: no OneSignal app id. Pass `{ appId: "..." }` in app.json plugins, or set EXPO_PUBLIC_ONESIGNAL_APP_ID / ONESIGNAL_APP_ID in the build environment.',
    );
  }

  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        `withOneSignalAndroidInit: expected Kotlin MainApplication but got ${cfg.modResults.language}.`,
      );
    }
    let contents = cfg.modResults.contents;
    contents = injectImports(contents);
    contents = injectInit(contents, appId);
    cfg.modResults.contents = contents;
    return cfg;
  });
};

module.exports = withOneSignalAndroidInit;
