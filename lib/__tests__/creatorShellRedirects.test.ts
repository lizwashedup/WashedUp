/** Existing role-specific landing routes remain valid within Yours. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  creatorLandingRoute,
  type CreatorAccess,
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

describe('creatorLandingRoute (redirect destination once access is granted)', () => {
  it.each<[CreatorAccess, string]>([
    [access({ ledCommunities: led('leader') }), '/(tabs)/friends/manage/(tools)/today'],
    [access({ ledCommunities: led('member_care') }), '/(tabs)/friends/manage/(tools)/members'],
    [access({ ledCommunities: led('finance') }), '/(tabs)/friends/manage/(tools)/menu'],
    [access({ ledCommunities: led('events') }), '/(tabs)/friends/manage/(tools)/events'],
    [access({ hasEventHostGrant: true }), '/(tabs)/friends/manage/(tools)/organizer-home'],
  ])('lands at %s', (a, expected) => {
    expect(creatorLandingRoute(a)).toBe(expected);
  });
});

describe('management keeps the main app navigation', () => {
  it('checks revoked access before the plain no-access redirect', () => {
    const source = readFileSync(resolve(__dirname, '../../components/creator/ManagementLayout.tsx'), 'utf8');
    expect(source.indexOf('access?.isRevoked')).toBeLessThan(source.indexOf('if (!hasCreatorAccess(access)) return'));
    expect(source).not.toContain('<Tabs');
  });
  it('nests tools under Yours without adding a sixth tab', () => {
    const source = readFileSync(resolve(__dirname, '../../app/(tabs)/_layout.tsx'), 'utf8');
    expect(source).toContain('name="friends"');
    expect(source).not.toContain('name="friends/index"');
    expect(source).not.toContain('name="manage"');
  });
});

describe('event summary emergency rollback contract', () => {
  const eventsSource = readFileSync(resolve(__dirname, '../../app/(creator)/events.tsx'), 'utf8');

  it('keeps the event-card landing route behind the same flag as the visible summary action', () => {
    expect(eventsSource).toMatch(
      /EVENT_SUMMARY_ENABLED\s*\? `\/creator\/event-summary\?id=\$\{e\.id\}`\s*:\s*`\/creator\/attendees\?id=\$\{e\.id\}`/,
    );
  });

  it('keeps all six event filters readable instead of compressing or wrapping them', () => {
    expect(eventsSource).toContain('<ScrollView\n          horizontal');
    expect(eventsSource).toContain('contentContainerStyle={styles.segmentRow}');
    expect(eventsSource).toContain('numberOfLines={1}');
    expect(eventsSource).toContain('adjustsFontSizeToFit');
    expect(eventsSource).toContain('style={[styles.segmentText');
    expect(eventsSource).toContain('segment: { flexShrink: 0');
  });
});
