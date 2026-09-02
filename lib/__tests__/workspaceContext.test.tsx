/**
 * Build 35 batch A, item A4: "workspace selection persists, and switching
 * workspace never changes an event's owner (acceptance criterion 3)."
 *
 * WHAT "WORKSPACE" MEANS: two related but distinct switches.
 *   1. ../selectedCommunity.ts + CommunitySwitcher.tsx (delta matrix Screen
 *      32's "unlabeled pills" on native) -- switches between COMMUNITIES a
 *      leader leads, all under the one existing Community product.
 *   2. ../workspaceContext.ts (this file's other half, built for A4) --
 *      the PRODUCT-level switch between the Organization product and the
 *      Community product. The delta matrix says this explicitly: "this
 *      switches between communities, not between the Organization product
 *      and the Community product. The product-level switch is new and
 *      belongs to the foundation batch." Before this file's workspaceContext
 *      tests below were written, no such code existed anywhere in the repo.
 *
 * PROVEN below, real and passing:
 *   - the existing community switcher's selection/fallback logic is correct
 *   - it now persists across an app relaunch (AsyncStorage), closing the
 *     real gap an earlier version of this file caught: state held only in
 *     memory, with its own module-load test proving that
 *   - the new product-level Organization-vs-Community workspace exists,
 *     resolves correctly against what a creator actually has access to,
 *     and also persists across an app relaunch
 *   - neither module touches the database at all (no supabase/rpc/update
 *     reference in either source), so persistence for both is local-device
 *     only and neither can be the write path for anything durable server-side
 *
 * NOT PROVEN, and cannot be until Josh applies the drafted A1 migration
 * (supabase/migrations/20260901010000_build35_event_ownership.sql -- DRAFT,
 * not applied to any database): the PDF's actual acceptance criterion 3
 * (switching the Organization/Community product-level workspace never
 * changes an event's owner). The product-level workspace itself is no
 * longer the blocker -- only the live owner_type/owner_id columns are. See
 * the skipped spec at the bottom.
 */

import React from 'react';
import { act, create } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setSelectedCommunityId, useLedCommunity } from '../selectedCommunity';
import { resolveWorkspace, setWorkspace, useWorkspace, type Workspace } from '../workspaceContext';
import type { CreatorAccess } from '../creatorMode';

function ledCommunity(id: string, name: string) {
  return { id, handle: id, name, status: 'active' as const, role: 'leader' as const };
}

const twoLed: CreatorAccess = {
  ledCommunities: [ledCommunity('community-a', 'Alpha'), ledCommunity('community-b', 'Beta')],
  hasLeaderGrant: true,
  hasEventHostGrant: false,
  isRevoked: false,
};

/** Leads a community AND holds an approved event_host grant -- the real case A4 exists for: today creatorShellKind always resolves this to the Community shell, with no way to work the other side. */
const bothAvailable: CreatorAccess = {
  ledCommunities: [ledCommunity('community-a', 'Alpha')],
  hasLeaderGrant: true,
  hasEventHostGrant: true,
  isRevoked: false,
};

/** The organizer-only shape: an approved event_host grant, no led community. */
const organizationOnly: CreatorAccess = {
  ledCommunities: [],
  hasLeaderGrant: false,
  hasEventHostGrant: true,
  isRevoked: false,
};

/** No creator access to either product at all. */
const neitherAvailable: CreatorAccess = {
  ledCommunities: [],
  hasLeaderGrant: false,
  hasEventHostGrant: false,
  isRevoked: false,
};

let lastResolved: ReturnType<typeof useLedCommunity> = null;
function Harness({ access }: { access: CreatorAccess }) {
  lastResolved = useLedCommunity(access);
  return null;
}

let lastWorkspace: Workspace | null | 'not-yet-rendered' = 'not-yet-rendered';
function WorkspaceHarness({ access }: { access: CreatorAccess }) {
  lastWorkspace = useWorkspace(access);
  return null;
}

// useSelectedCommunityId/useRawWorkspace subscribe each mounted Harness to
// its shared store, so a renderer left mounted past its own test keeps
// re-firing the module-level `last*` variables on every later set*() call
// from a LATER test. Track and unmount every renderer this file creates so
// only the current test's Harness is ever subscribed.
const activeRenderers: ReturnType<typeof create>[] = [];

function renderHarness(access: CreatorAccess) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Harness access={access} />);
  });
  activeRenderers.push(renderer);
  return renderer;
}

function renderWorkspaceHarness(access: CreatorAccess) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<WorkspaceHarness access={access} />);
  });
  activeRenderers.push(renderer);
  return renderer;
}

afterEach(async () => {
  act(() => {
    while (activeRenderers.length) activeRenderers.pop()!.unmount();
  });
  act(() => setSelectedCommunityId(null));
  lastResolved = null;
  lastWorkspace = 'not-yet-rendered';
  await AsyncStorage.clear();
});

describe('useLedCommunity (the real community-to-community switcher)', () => {
  it('defaults to the first (oldest-led) community when nothing is selected', () => {
    renderHarness(twoLed);
    expect(lastResolved?.id).toBe('community-a');
  });

  it('moves every consumer to the newly selected community', () => {
    const renderer = renderHarness(twoLed);
    act(() => setSelectedCommunityId('community-b'));
    act(() => renderer.update(<Harness access={twoLed} />));
    expect(lastResolved?.id).toBe('community-b');
  });

  it('falls back to the first led community if the selected one is no longer led, rather than erroring or going stale', () => {
    const renderer = renderHarness(twoLed);
    act(() => setSelectedCommunityId('community-b'));
    act(() => renderer.update(<Harness access={twoLed} />));
    expect(lastResolved?.id).toBe('community-b');

    const droppedFromB: CreatorAccess = { ...twoLed, ledCommunities: [twoLed.ledCommunities[0]] };
    act(() => renderer.update(<Harness access={droppedFromB} />));
    expect(lastResolved?.id).toBe('community-a');
  });
});

describe('community selection persistence (AsyncStorage, A4)', () => {
  it('persists across a fresh module load -- closes the real gap an earlier version of this test caught', async () => {
    renderHarness(twoLed);
    act(() => setSelectedCommunityId('community-b'));
    expect(lastResolved?.id).toBe('community-b');
    // give the fire-and-forget AsyncStorage.setItem inside
    // setSelectedCommunityId a turn to actually land before simulating relaunch
    await Promise.resolve();

    // A fresh require of react/react-test-renderer/selectedCommunity together
    // (not the outer-scope imports) simulates an app relaunch: a brand-new
    // module registry with selectedId back to its unset initial value. The
    // globally jest.mock()'d AsyncStorage module is NOT reset by
    // isolateModules (verified: it is the same singleton object inside and
    // outside the sandbox), exactly like real on-device storage survives a
    // JS relaunch that resets everything else -- so this is a faithful
    // simulation, not a workaround. Mixing the outer React with a freshly-
    // required selectedCommunity would break React's hook dispatcher (two
    // different React instances), so everything below comes from the same
    // isolated registry. isolateModules' own callback must stay synchronous
    // (that is its documented contract), so it only requires the fresh
    // modules and kicks off the async hydrate, capturing the promise to
    // await afterward -- the render itself also happens afterward, using
    // the captured fresh references directly (no further `require` calls,
    // so it does not matter that the sandbox has by then closed).
    let ReactFresh!: typeof React;
    let createFresh!: typeof import('react-test-renderer').create;
    let actFresh!: typeof import('react-test-renderer').act;
    let fresh!: typeof import('../selectedCommunity');
    let hydratePromise!: Promise<void>;
    jest.isolateModules(() => {
      ReactFresh = require('react');
      ({ create: createFresh, act: actFresh } = require('react-test-renderer'));
      fresh = require('../selectedCommunity');
      hydratePromise = fresh.hydrateSelectedCommunity();
    });
    await hydratePromise;

    let freshSelection: string | null = null;
    function FreshHarness() {
      freshSelection = fresh.useSelectedCommunityId();
      return null;
    }
    actFresh(() => {
      createFresh(ReactFresh.createElement(FreshHarness));
    });

    expect(freshSelection).toBe('community-b');
  });

  it('still has no direct database reference -- AsyncStorage is its only durable write path', () => {
    const source = readFileSync(resolve(__dirname, '../selectedCommunity.ts'), 'utf8');
    expect(source).toMatch(/AsyncStorage/);
    expect(source).not.toMatch(/supabase|\.rpc\(|\.update\(/);
  });
});

describe('resolveWorkspace (pure fallback logic, no rendering)', () => {
  it('defaults to Community when nothing has been chosen and both products are available -- matches creatorShellKind\'s existing isLeaderAccess-first precedence', () => {
    expect(resolveWorkspace(null, bothAvailable)).toBe('community');
  });

  it('defaults to Organization when nothing has been chosen and only Organization is available', () => {
    expect(resolveWorkspace(null, organizationOnly)).toBe('organization');
  });

  it('defaults to Community when nothing has been chosen and only Community is available', () => {
    expect(resolveWorkspace(null, twoLed)).toBe('community');
  });

  it('returns null when the creator has access to neither product', () => {
    expect(resolveWorkspace(null, neitherAvailable)).toBeNull();
    expect(resolveWorkspace('organization', neitherAvailable)).toBeNull();
  });

  it('honors an explicit Organization choice even when Community is also available -- the real case A4 exists for', () => {
    expect(resolveWorkspace('organization', bothAvailable)).toBe('organization');
  });

  it('honors an explicit Community choice when both are available', () => {
    expect(resolveWorkspace('community', bothAvailable)).toBe('community');
  });

  it('falls back away from a chosen product that is no longer available, rather than going stale', () => {
    // chose Organization, then the event_host grant is revoked, but they
    // still lead a community
    expect(resolveWorkspace('organization', twoLed)).toBe('community');
    // chose Community, then they stop leading any community, but still
    // hold an event_host grant
    expect(resolveWorkspace('community', organizationOnly)).toBe('organization');
  });
});

describe('useWorkspace (hook + persistence, A4 product-level workspace)', () => {
  it('resolves through the live store: setWorkspace moves every consumer, same shape as setSelectedCommunityId', () => {
    setWorkspace('community');
    const renderer = renderWorkspaceHarness(bothAvailable);
    expect(lastWorkspace).toBe('community');

    act(() => setWorkspace('organization'));
    act(() => renderer.update(<WorkspaceHarness access={bothAvailable} />));
    expect(lastWorkspace).toBe('organization');
  });

  it('falls back live when the chosen product drops out from under the current selection', () => {
    setWorkspace('organization');
    const renderer = renderWorkspaceHarness(bothAvailable);
    expect(lastWorkspace).toBe('organization');

    // the event_host grant is revoked out from under an active Organization
    // selection -- must fall back to Community, not go stale or blank
    const communityOnlyNow: CreatorAccess = { ...bothAvailable, hasEventHostGrant: false };
    act(() => renderer.update(<WorkspaceHarness access={communityOnlyNow} />));
    expect(lastWorkspace).toBe('community');
  });

  it('persists across a fresh module load, same mechanism and same guarantee as selectedCommunity above', async () => {
    setWorkspace('organization');
    renderWorkspaceHarness(organizationOnly);
    expect(lastWorkspace).toBe('organization');
    await Promise.resolve();

    let ReactFresh!: typeof React;
    let createFresh!: typeof import('react-test-renderer').create;
    let actFresh!: typeof import('react-test-renderer').act;
    let fresh!: typeof import('../workspaceContext');
    let hydratePromise!: Promise<void>;
    jest.isolateModules(() => {
      ReactFresh = require('react');
      ({ create: createFresh, act: actFresh } = require('react-test-renderer'));
      fresh = require('../workspaceContext');
      hydratePromise = fresh.hydrateWorkspace();
    });
    await hydratePromise;

    let freshWorkspace: Workspace | null = null;
    function FreshWorkspaceHarness() {
      freshWorkspace = fresh.useRawWorkspace();
      return null;
    }
    actFresh(() => {
      createFresh(ReactFresh.createElement(FreshWorkspaceHarness));
    });

    expect(freshWorkspace).toBe('organization');
  });

  it('has no direct database reference -- AsyncStorage is its only durable write path', () => {
    const source = readFileSync(resolve(__dirname, '../workspaceContext.ts'), 'utf8');
    expect(source).toMatch(/AsyncStorage/);
    expect(source).not.toMatch(/supabase|\.rpc\(|\.update\(/);
  });
});

/**
 * BLOCKED on A1 only now (specs/washedup-MASTER-PLAN-v3-20260831.md §5.1).
 * A1: explore_events has zero owner_id/owner_type columns on any real
 * database today -- the design is resolved and a migration is drafted
 * (supabase/migrations/20260901010000_build35_event_ownership.sql), but
 * DRAFT and not applied, so there is still nothing live to assert
 * invariance over. The other half of this test's original blocker -- no
 * Organization-vs-Community product-level workspace to exercise -- is
 * resolved above: resolveWorkspace/useWorkspace/setWorkspace are real,
 * tested, and persisted.
 *
 * Written as a precise placeholder spec (fixture data, no real imports of
 * anything that doesn't exist yet) so it keeps compiling under
 * `npm run typecheck` while skipped, and can be filled in with the real
 * owner column unchanged in shape the moment A1 actually lands.
 */
it.skip("switching the Organization/Community workspace never changes an event's owner (acceptance criterion 3 -- blocked on A1's owner column landing on a real database)", () => {
  const fixtureEvent: { id: string; owner_type: 'organization' | 'community'; owner_id: string } = {
    id: 'event-1',
    owner_type: 'organization',
    owner_id: 'org-1',
  };

  setWorkspace('community');

  expect(fixtureEvent.owner_type).toBe('organization');
  expect(fixtureEvent.owner_id).toBe('org-1');
});
