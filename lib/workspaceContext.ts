/**
 * The Organization-vs-Community product-level workspace (master plan
 * specs/washedup-MASTER-PLAN-v3-20260831.md §5.1, A4: "prove route
 * redirects and the workspace context contract... workspace selection
 * persists").
 *
 * Distinct from ./selectedCommunity.ts, which only switches BETWEEN
 * communities a leader leads, under the one existing Community product.
 * The delta matrix says this in so many words (Screen 32): "this switches
 * between communities, not between the Organization product and the
 * Community product. The product-level switch is new and belongs to the
 * foundation batch." Verified 2026-09-01: no WorkspaceContext/useWorkspace
 * code existed anywhere in this repo before this file.
 *
 * "Organization" here is A2's resolved shape: a single person's own
 * organizer_profiles identity (the operator_grants `event_host` track --
 * CreatorAccess.hasEventHostGrant), the same signal creatorShellKind
 * (./creatorMode.ts) already uses to pick the 'organizer' shell.
 * "Community" is any led community (CreatorAccess.ledCommunities.length >
 * 0), the same signal the 'full' / 'events' / 'member_care' / 'finance'
 * shells key off. A person can hold both grants at once (e.g. a community
 * leader who is also an approved event host) -- today creatorShellKind
 * always resolves that case to the Community side ('full' wins, regardless
 * of hasEventHostGrant). This module makes that an explicit, rememberable
 * choice instead of a fixed, invisible precedence.
 *
 * Persisted (AsyncStorage) so the choice survives an app relaunch -- the
 * real gap this file's test proved (no persistence anywhere for this
 * concept, since the concept itself did not exist). A single global key:
 * the value is a 2-state device preference, not per-user data, and
 * resolveWorkspace's own availability fallback below already makes a
 * stale/foreign value harmless -- the same shape ./selectedCommunity.ts's
 * `led.find(...) ?? led[0]` fallback already relies on.
 *
 * NOT YET WIRED TO ANY SCREEN: no UI switcher renders this yet -- that is
 * later, UI-visible work, and master plan §5.1 is explicit that "nothing
 * here is user-visible" and navigation/UI does not move until this contract
 * is proven. hydrateWorkspace() IS wired into app/(creator)/_layout.tsx so
 * the persisted value is real and loaded the moment the creator shell
 * mounts, not merely theoretically readable.
 */

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreatorAccess } from './creatorMode';

export type Workspace = 'organization' | 'community';

const STORAGE_KEY = 'washedup.workspace';

let workspace: Workspace | null = null;
const listeners = new Set<() => void>();

function setInMemory(next: Workspace | null): void {
  workspace = next;
  listeners.forEach((l) => l());
}

/**
 * Sets and persists the creator's chosen workspace. Fire-and-forget write,
 * same best-effort shape as lib/pendingLink.ts: a failed write only costs
 * the NEXT relaunch's restore, never this session (the in-memory update
 * above already happened synchronously).
 */
export function setWorkspace(next: Workspace): void {
  setInMemory(next);
  AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
    /* best-effort */
  });
}

/**
 * Reads the persisted workspace back in. Call once, early (wired in
 * app/(creator)/_layout.tsx). Best-effort: a read failure, or nothing ever
 * saved, leaves the in-memory value at its initial null, which
 * resolveWorkspace's availability fallback below resolves exactly like a
 * genuine first-ever launch.
 */
export async function hydrateWorkspace(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === 'organization' || raw === 'community') setInMemory(raw);
  } catch {
    /* best-effort; stays null */
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Workspace | null {
  return workspace;
}

/**
 * The raw persisted/set choice, before the availability fallback below --
 * null until chosen or hydrated. Exported for tests and for any future
 * screen that needs the unresolved value; screens deciding what to render
 * should use useWorkspace instead.
 */
export function useRawWorkspace(): Workspace | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Resolves the raw choice against what this creator actually has access to
 * right now, the same never-stale shape ./selectedCommunity.ts's
 * useLedCommunity fallback already uses:
 *  - the chosen product, if the creator still has it
 *  - else whichever product they DO have (Community preferred, matching
 *    creatorShellKind's existing isLeaderAccess-first precedence in
 *    ./creatorMode.ts)
 *  - else null (no creator access to either product -- callers already
 *    gate on hasCreatorAccess before this matters, the same contract
 *    useLedCommunity already has with its own null case)
 * A pure function, so it is directly unit-testable without mounting a
 * component (see lib/__tests__/workspaceContext.test.tsx).
 */
export function resolveWorkspace(
  raw: Workspace | null,
  access: CreatorAccess | null | undefined,
): Workspace | null {
  const hasCommunity = (access?.ledCommunities.length ?? 0) > 0;
  const hasOrganization = !!access?.hasEventHostGrant;
  if (raw === 'community' && hasCommunity) return 'community';
  if (raw === 'organization' && hasOrganization) return 'organization';
  if (hasCommunity) return 'community';
  if (hasOrganization) return 'organization';
  return null;
}

/** The workspace the creator is actually in right now -- see resolveWorkspace. */
export function useWorkspace(access: CreatorAccess | null | undefined): Workspace | null {
  const raw = useRawWorkspace();
  return resolveWorkspace(raw, access);
}
