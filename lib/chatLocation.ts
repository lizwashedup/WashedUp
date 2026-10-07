/** A displayed pin, independent of the storage format used by each chat. */
export interface ChatLocation {
  latitude: number;
  longitude: number;
  address: string;
}

export function readChatLocation(latitude: unknown, longitude: unknown, address: unknown): ChatLocation | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, address: typeof address === 'string' ? address.trim() : '' };
}

/** Plan/Circle messages keep their existing JSON payload; malformed data must
 * never silently become a real (0, 0) pin. Zero itself is a valid coordinate. */
export function parsePlanChatLocation(body: string): ChatLocation | null {
  try {
    const value = JSON.parse(body);
    return readChatLocation(value?.lat, value?.lng, value?.address);
  } catch { return null; }
}

export function chatLocationLabel(location: ChatLocation): string {
  return location.address || `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}
