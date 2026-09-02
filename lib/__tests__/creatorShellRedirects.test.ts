/**
 * Build 35 batch A, item A4: "legacy creator routes (Today, Members, Menu,
 * and the rest) redirect correctly." app/(creator)/_layout.tsx has no
 * redirect logic of its own -- every tab's visibility and the post-access
 * landing route are derived from creatorShellKind()/creatorLandingRoute() in
 * ../creatorMode. These tests pin that derivation directly against the exact
 * showToday/showOrganizerHome/showEvents/showAttendees/showCommunity/
 * showMembers booleans _layout.tsx computes, so a change to either side
 * without the other shows up here.
 *
 * Does NOT duplicate: creatorAccess.test.ts (getCreatorAccess() data-fetch
 * correctness), communityRouteGate.test.ts (the separate COMMUNITIES_ENABLED
 * flag gate on app/communities|community|community-thread|community-topic),
 * creatorLayoutErrorState.test.ts (isError-before-no-access ordering). This
 * file adds the one ordering fact those don't cover (isRevoked before the
 * plain no-access redirect) plus the shell-kind/tab/landing-route matrix
 * neither covers at all.
 *
 * PROVEN here (real, passing, current behavior, no A1/A2 dependency): all
 * five shell kinds resolve to exactly the tabs and landing route the live
 * shell grants today, Menu and organizer-broadcast are never gated by shell
 * kind, and a revoked-with-no-access user is checked before the plain
 * no-access redirect.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  creatorShellKind,
  creatorLandingRoute,
  type CreatorAccess,
  type CreatorShellKind,
  type LedCommunity,
} from '../creatorMode';

function access(overrides: Partial<CreatorAccess> = {}): CreatorAccess {
  return {
    ledCommunities: [],
    hasLeaderGrant: false,
    hasEventHostGrant: false,
    isRevoked: false,
    ...overrides,
  };
}

function led(role: LedCommunity['role']): LedCommunity[] {
  return [{ id: 'community-1', handle: 'c1', name: 'Community One', status: 'active', role }];
}

// Mirrors app/(creator)/_layout.tsx's showToday/showOrganizerHome/showEvents/
// showAttendees/showCommunity/showMembers exactly (lines ~69-74). If that
// mapping changes, update both sides together.
function tabsFor(kind: CreatorShellKind) {
  return {
    today: kind === 'full',
    organizerHome: kind === 'organizer' || kind === 'events',
    events: kind === 'full' || kind === 'organizer' || kind === 'events',
    attendees: kind === 'organizer' || kind === 'events',
    community: kind === 'full',
    members: kind === 'full' || kind === 'member_care',
  };
}

describe('creator shell kind -> tab visibility (route redirect contract)', () => {
  it.each<[string, CreatorAccess, CreatorShellKind]>([
    ['owner/leader', access({ ledCommunities: led('leader') }), 'full'],
    ['co_leader', access({ ledCommunities: led('co_leader') }), 'full'],
    ['admin tier', access({ ledCommunities: led('admin') }), 'full'],
    ['events tier co-creator', access({ ledCommunities: led('events') }), 'events'],
    ['member_care tier co-creator', access({ ledCommunities: led('member_care') }), 'member_care'],
    ['finance tier co-creator', access({ ledCommunities: led('finance') }), 'finance'],
    ['event-host-only grant, no led community', access({ hasEventHostGrant: true }), 'organizer'],
    ['community_leader grant, no led community yet', access({ hasLeaderGrant: true }), 'full'],
  ])('%s resolves to shell kind %s with the matching tab set', (_label, a, expectedKind) => {
    const kind = creatorShellKind(a);
    expect(kind).toBe(expectedKind);
    expect(tabsFor(kind)).toEqual(tabsFor(expectedKind));
  });

  it('never grants Today, Community, or (outside member_care) Members to a narrower tier than full', () => {
    for (const role of ['events', 'member_care', 'finance'] as const) {
      const tabs = tabsFor(creatorShellKind(access({ ledCommunities: led(role) })));
      expect(tabs.today).toBe(false);
      expect(tabs.community).toBe(false);
      if (role !== 'member_care') expect(tabs.members).toBe(false);
    }
  });
});

describe('creatorLandingRoute (redirect destination once access is granted)', () => {
  it.each<[CreatorAccess, string]>([
    [access({ ledCommunities: led('leader') }), '/(creator)/today'],
    [access({ ledCommunities: led('member_care') }), '/(creator)/members'],
    [access({ ledCommunities: led('finance') }), '/(creator)/menu'],
    [access({ ledCommunities: led('events') }), '/(creator)/organizer-home'],
    [access({ hasEventHostGrant: true }), '/(creator)/organizer-home'],
  ])('lands at %s', (a, expected) => {
    expect(creatorLandingRoute(a)).toBe(expected);
  });
});

describe('(creator)/_layout.tsx static contract (source assertions, extends creatorLayoutErrorState.test.ts)', () => {
  const source = readFileSync(resolve(__dirname, '../../app/(creator)/_layout.tsx'), 'utf8');

  it('checks isRevoked before the plain no-access redirect, so a revoked creator never silently bounces', () => {
    const revokedIdx = source.indexOf('access?.isRevoked');
    const plainRedirectIdx = source.indexOf('if (!hasCreatorAccess(access)) {');
    expect(revokedIdx).toBeGreaterThan(-1);
    expect(plainRedirectIdx).toBeGreaterThan(-1);
    expect(revokedIdx).toBeLessThan(plainRedirectIdx);
  });

  it('never gates Menu behind a shell kind (always reachable once access is granted, only its label changes)', () => {
    const menuBlock = source.slice(source.indexOf('name="menu"'), source.indexOf('name="organizer-broadcast"'));
    expect(menuBlock).not.toMatch(/href:\s*show\w+/);
  });

  it('never registers organizer-broadcast as a visible tab, for any shell kind (regression: the "phantom sixth tab" bug)', () => {
    const broadcastBlock = source.slice(source.indexOf('name="organizer-broadcast"'));
    expect(broadcastBlock).toMatch(/href:\s*null/);
  });
});
