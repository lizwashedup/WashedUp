/**
 * Expo app config — single source of truth for the Google Maps API key.
 * app.json intentionally does NOT contain a googleMaps key; this file owns it
 * for both iOS and Android via the spread+override below.
 *
 * Key resolution order (first non-empty value wins):
 *   1. GOOGLE_MAPS_API_KEY       — EAS Secret (production builds, not prefixed so it stays server-side)
 *   2. EXPO_PUBLIC_GOOGLE_MAPS_API_KEY — local .env for dev (also consumed by GooglePlacesAutocomplete at runtime)
 *   3. Hard-coded fallback        — keeps CI/preview builds working; requires Places API enabled
 *                                   with NO app-bundle-ID restriction in Google Cloud Console.
 *
 * Google Cloud Console checklist for the key AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw:
 *   - APIs & Services → Library → "Places API" → ENABLED
 *   - APIs & Services → Library → "Maps SDK for iOS" → ENABLED
 *   - APIs & Services → Library → "Maps SDK for Android" → ENABLED
 *   - APIs & Services → Credentials → the key → Application restrictions:
 *       Set to "None" — OR both an iOS bundle restriction (com.washedup.app)
 *       AND an Android package+SHA-1 restriction. Mixing one-platform restriction
 *       with this shared key will silently break the other platform.
 *   - Quota & billing must be active (Places API requires a billing account)
 */
const appJson = require('./app.json');

const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  'AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw';

// Build the reversed iOS client ID URL scheme required by @react-native-google-signin/google-signin.
// Google Sign-In redirects back to the app using this scheme after authentication.
// Format: com.googleusercontent.apps.{prefix-from-ios-client-id}
// Falls back to hardcoded value for EAS cloud builds that don't read .env.local
const googleIosClientId =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ||
  '818215560025-fckeechpsjbvhfmupdb17j3nik45d0p2.apps.googleusercontent.com';
const googleIosUrlScheme =
  'com.googleusercontent.apps.' + googleIosClientId.replace('.apps.googleusercontent.com', '');

// EAS Build fingerprints can include secret-backed native config values that
// are intentionally unavailable to a local OTA export. That can make a safe
// JS-only update compute a different runtime from the exact store binary it is
// meant to patch. The guarded OTA script may therefore target a verified EAS
// build's recorded runtime explicitly. Never allow that override during a
// native build: new binaries must keep deriving their own fingerprint.
const otaRuntimeVersion = process.env.WASHEDUP_OTA_RUNTIME_VERSION?.trim();
if (otaRuntimeVersion && process.env.EAS_BUILD === 'true') {
  throw new Error('WASHEDUP_OTA_RUNTIME_VERSION is for guarded OTA exports only, never EAS Build.');
}

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
    // Inject iosUrlScheme into the Google Sign-In plugin so it registers the redirect URL scheme.
    // This overrides the plain string entry from app.json with the configured object form.
    plugins: [
      ...appJson.expo.plugins.map((p) => {
        if (p === '@react-native-google-signin/google-signin') {
          return ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }];
        }
        return p;
      }),
      // Re-applies the AppCheckCore modular-headers Podfile patch during prebuild
      // (ios/ is gitignored, so the manual edit doesn't reach EAS). Fixes the
      // iOS "Install pods" failure on cloud builds.
      './plugins/withIosModularHeaders',
      // expo-camera powers door check-in's ticket scan (spec 100 P0 #5). The
      // permission string is the iOS/Android prompt shown at first use.
      // LIZ COPY (taste gate).
      ['expo-camera', { cameraPermission: 'washedup uses the camera to scan tickets at your door.' }],
    ],
    updates: {
      url: 'https://u.expo.dev/9584097f-8f32-4fce-ae36-e87c1ffd50cc',
      // Boot the embedded/cached bundle immediately. Updates still download in
      // the background and apply on the next launch, without holding every
      // startup at the splash screen while the network is slow or unavailable.
      // NOTE: native config — only takes effect in a new build, not over OTA.
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: otaRuntimeVersion || {
      policy: 'fingerprint',
    },
    ios: {
      ...appJson.expo.ios,
      config: {
        ...appJson.expo.ios?.config,
        googleMapsApiKey,
      },
    },
    android: {
      ...appJson.expo.android,
      config: {
        ...appJson.expo.android?.config,
        googleMaps: {
          ...appJson.expo.android?.config?.googleMaps,
          apiKey: googleMapsApiKey,
        },
      },
    },
  },
};
