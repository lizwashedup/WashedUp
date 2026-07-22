/**
 * The creator's selected community (C11, the multi-community switcher).
 *
 * operator_grants are per-user, so one community_leader grant covers any
 * number of communities. Every creator write surface used to read
 * ledCommunities[0] silently (and the membership query had no order-by, so
 * WHICH community was [0] was nondeterministic). This tiny store holds the
 * selected community id for the whole creator shell; screens resolve it
 * through useLedCommunity so they all move together when the switcher
 * changes it. Resets on app restart, defaults to the oldest-led community
 * (getCreatorAccess now orders by joined_at).
 */

import { useSyncExternalStore } from 'react';
import type { CreatorAccess, LedCommunity } from './creatorMode';

let selectedId: string | null = null;
const listeners = new Set<() => void>();

export function setSelectedCommunityId(id: string | null): void {
  selectedId = id;
  listeners.forEach((l) => l());
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
