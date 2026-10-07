const PREFIX = 'washedup-location:v1:';

export interface CommunityLocationMessage {
  latitude: number;
  longitude: number;
  address: string;
}

export function encodeCommunityLocation(location: CommunityLocationMessage): string {
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('Choose a valid location before sending.');
  }
  return PREFIX + JSON.stringify({ latitude, longitude, address: location.address.trim().slice(0, 200) });
}

export function parseCommunityLocation(body: string): CommunityLocationMessage | null {
  if (!body.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(body.slice(PREFIX.length)) as Partial<CommunityLocationMessage>;
    if (typeof value.latitude !== 'number' || typeof value.longitude !== 'number' ||
        typeof value.address !== 'string' ||
        !Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
        value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180) return null;
    return { latitude: value.latitude, longitude: value.longitude, address: value.address };
  } catch { return null; }
}

export function communityMessagePreview(body: string): string {
  return parseCommunityLocation(body) ? 'Shared a location' : body;
}

export function communityLocationMapUrl(location: CommunityLocationMessage): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}
