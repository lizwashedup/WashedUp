/**
 * Admin view-as (Liz's call, doc 00 7-13): a session-scoped, admin-only
 * override that forces the event-host-only shell client-side. When on,
 * getCreatorAccess reports leader=false / event_host=true, so every creator
 * surface downstream (tab shell, landing route, guards, attribution,
 * switcher) behaves exactly as it would for a real event host. Nothing is
 * written anywhere; restarting the app clears it. Seeds view-as-member
 * (v1.1). The setter is only reachable from admin UI AND the override is
 * re-checked against isAdmin at the access layer, so it is inert for
 * everyone else.
 */

import { useSyncExternalStore } from 'react';

let viewAsEventHost = false;
const listeners = new Set<() => void>();

export function isViewingAsEventHost(): boolean {
  return viewAsEventHost;
}

export function setViewAsEventHost(on: boolean): void {
  viewAsEventHost = on;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useViewAsEventHost(): boolean {
  return useSyncExternalStore(subscribe, isViewingAsEventHost);
}
