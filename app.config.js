/**
 * Expo app config.
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
 *       Set to "None" (or iOS/Android with correct bundle IDs) — NOT "HTTP referrers"
 *   - Quota & billing must be active (Places API requires a billing account)
 */
const appJson = require('./app.json');

const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  'AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw';

module.exports = {
  ...appJson,
  expo: {
    ...appJson.expo,
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
