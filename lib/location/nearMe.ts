/**
 * Just-in-time location for the "Near me" feed toggle.
 *
 * Requests foreground location permission ONLY when called (on the Near-me tap),
 * never at app start. Returns coords on grant, or a reason it couldn't. Uses
 * last-known position first (instant, no GPS spin) and falls back to a fresh
 * balanced-accuracy fix. Mirrors the expo-location use in the composer place
 * picker; expo-location is already a dependency, so this is pure-JS.
 */
import * as Location from 'expo-location';

export type NearMeCoords = { lat: number; lng: number };

export type NearMeResult =
  | { ok: true; coords: NearMeCoords }
  | { ok: false; reason: 'denied' | 'unavailable' };

export async function requestNearMeLocation(): Promise<NearMeResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { ok: false, reason: 'denied' };

    const pos =
      (await Location.getLastKnownPositionAsync({})) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (!pos) return { ok: false, reason: 'unavailable' };

    return { ok: true, coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
