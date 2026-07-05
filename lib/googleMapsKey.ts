/**
 * GOOGLE_MAPS_API_KEY - the ONE place the client Maps/Places key comes from.
 *
 * EXPO_PUBLIC_ vars are inlined into the JS bundle at build/publish time, so
 * an `eas update` run from a shell without EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
 * ships an empty key. That exact miss (the 2026-06-30 splash-audio OTA) broke
 * composer place search in prod for four days: PlacePicker had `?? ''` while
 * the plan-detail edit screen had this fallback, which is why "create fails,
 * edit works" was the user-reported shape.
 *
 * The fallback below is the same client key already shipped in every store
 * build (eas.json env) and in app/plan/[id].tsx; a Google Maps browser/app
 * key is client-exposed by design. Lock it to the app bundle IDs in the
 * Google Cloud console; never put a server-side key here.
 */
export const GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  'AIzaSyApjwAgT5x1pw5NgqSvrACmZaKapYuXgCw';
