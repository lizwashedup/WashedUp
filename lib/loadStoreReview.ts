// Keep the native module lazy so older binaries can still load the app; callers
// handle an unavailable module without blocking navigation.
export function loadStoreReview() { return import('expo-store-review'); }
