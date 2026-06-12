/**
 * Recent places - a small local store (AsyncStorage) of the last places a
 * creator picked, surfaced in the place picker's search state with relative-
 * time provenance ("used last week"). Most-recent-first, deduped by name,
 * capped. Local only; never leaves the device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface RecentPlace {
  name: string;
  lat: number | null;
  lng: number | null;
  neighborhood: string | null;
  usedAt: number; // epoch ms
}

const KEY = 'washedup_recent_places_v1';
const CAP = 8;

export async function loadRecentPlaces(): Promise<RecentPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as RecentPlace[]) : [];
    return arr
      .filter((r) => r && typeof r.name === 'string')
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, CAP);
  } catch {
    return [];
  }
}

export async function addRecentPlace(place: Omit<RecentPlace, 'usedAt'>, now: number): Promise<void> {
  if (!place.name.trim()) return;
  try {
    const existing = await loadRecentPlaces();
    const deduped = existing.filter((r) => r.name.toLowerCase() !== place.name.toLowerCase());
    const next: RecentPlace[] = [{ ...place, usedAt: now }, ...deduped].slice(0, CAP);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // best-effort; a recents write failure must never block posting
  }
}

export function relativeUsed(usedAt: number, now: number): string {
  const days = Math.floor((now - usedAt) / 86_400_000);
  if (days <= 0) return 'used today';
  if (days === 1) return 'used yesterday';
  if (days < 7) return `used ${days} days ago`;
  if (days < 14) return 'used last week';
  if (days < 30) return `used ${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'used last month';
  return `used ${Math.floor(days / 30)} months ago`;
}
