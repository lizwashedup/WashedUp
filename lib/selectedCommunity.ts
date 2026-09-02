/**
 * The creator's selected community (C11, the multi-community switcher).
 *
 * operator_grants are per-user, so one community_leader grant covers any
 * number of communities. Every creator write surface used to read
 * ledCommunities[0] silently (and the membership query had no order-by, so
 * WHICH community was [0] was nondeterministic). This tiny store holds the
 * selected community id for the whole creator shell; screens resolve it
 * through useLedCommunity so they all move together when the switcher
 * changes it.
 *
 * Persisted (AsyncStorage, master plan §5.1 A4: "workspace selection
 * persists"): hydrateSelectedCommunity() restores it once at app start
 * (wired in app/(creator)/_layout.tsx); setSelectedCommunityId writes it
 * every time it changes. A single global key, not per-user -- a stale id
 * left over from a previous account is already harmless by construction,
 * since useLedCommunity below falls back to led[0] the instant the
 * persisted id does not match a currently-led community. Defaults to the
 * oldest-led community (getCreatorAccess orders by joined_at) whenever
 * nothing was ever persisted, or the persisted id no longer resolves.
 */

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreatorAccess, LedCommunity } from './creatorMode';

const STORAGE_KEY = 'washedup.selectedCommunityId';

let selectedId: string | null = null;
const listeners = new Set<() => void>();

function setInMemory(id: string | null): void {
  selectedId = id;
  listeners.forEach((l) => l());
}

export function setSelectedCommunityId(id: string | null): void {
  setInMemory(id);
  const write = id === null ? AsyncStorage.removeItem(STORAGE_KEY) : AsyncStorage.setItem(STORAGE_KEY, id);
  write.catch(() => {
    /* best-effort, same shape as lib/pendingLink.ts -- a failed write only
       costs the NEXT relaunch's restore, never this session */
  });
}

/**
 * Reads the persisted selection back in. Call once, early (wired in
 * app/(creator)/_layout.tsx). Best-effort: a read failure, or nothing ever
 * saved, leaves selectedId at its initial null -- the same state a genuine
 * first-ever launch is already in, which useLedCommunity's own fallback
 * below already handles.
 */
export async function hydrateSelectedCommunity(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) setInMemory(raw);
  } catch {
    /* best-effort; stays null */
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string | null {
  return selectedId;
}

export function useSelectedCommunityId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * The community the creator is currently working AS: the selected one when
 * it is still led, else the first (oldest) led community. Every creator
 * surface resolves through this, never through ledCommunities[0].
 */
export function useLedCommunity(access: CreatorAccess | null | undefined): LedCommunity | null {
  const id = useSelectedCommunityId();
  const led = access?.ledCommunities ?? [];
  return led.find((c) => c.id === id) ?? led[0] ?? null;
}
