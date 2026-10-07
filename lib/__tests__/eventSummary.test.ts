import { eventSummaryAccess, eventSummaryDate, eventSummaryId, summaryStatusLine } from '../eventSummary';
import type { CreatorAccess, LedCommunity } from '../creatorMode';
const event = { community_id: 'one', host_user_id: 'viewer' };
const access = (role?: LedCommunity['role'], community = 'one', grant = false): CreatorAccess => ({ ledCommunities: role ? [{ id: community, role, status: 'active', name: 'Sample', handle: 'sample' }] : [], hasLeaderGrant: false, hasEventHostGrant: grant, isRevoked: false });
it.each(['leader', 'co_leader', 'admin'] as const)('%s gets both tools for this community', role => expect(eventSummaryAccess(event, access(role), 'viewer')).toEqual({ events: true, finance: true }));
it.each(['events', 'finance', 'member_care'] as const)('keeps %s role boundaries', role => expect(eventSummaryAccess(event, access(role), 'viewer')).toEqual({ events: role === 'events', finance: role === 'finance' }));
it('rejects another community even when the viewer created the event and has a personal grant', () => expect(eventSummaryAccess(event, access('leader', 'other', true), 'viewer')).toEqual({ events: false, finance: false }));
it('permits only own personal event with an approved grant', () => {
 expect(eventSummaryAccess({ ...event, community_id: null }, access(undefined, 'one', true), 'viewer')).toEqual({ events: true, finance: true });
 expect(eventSummaryAccess({ ...event, community_id: null }, access(undefined, 'one', true), 'other')).toEqual({ events: false, finance: false });
 expect(eventSummaryAccess({ ...event, community_id: null }, access('leader'), 'viewer')).toEqual({ events: false, finance: false });
});
it.each([null, undefined])('does not treat absent identity/access/event as permission (%s)', value => {
 expect(eventSummaryAccess(value, access('leader'), 'viewer').events).toBe(false);
 expect(eventSummaryAccess(event, value, 'viewer').events).toBe(false);
 expect(eventSummaryAccess(event, access('leader'), value).events).toBe(false);
});
it.each([undefined, null, '', ' ', ['one'], ['one', 'two']])('rejects ambiguous route %j', id => expect(eventSummaryId(id)).toBeNull());
it('normalizes a single route ID', () => expect(eventSummaryId(' one ')).toBe('one'));
it('uses LA day rather than UTC midnight for date-only event status', () => expect(summaryStatusLine('Live', '2026-09-01', '2026-09-02T02:00:00Z')).toBe('scheduled'));
it.each(['cancelled', 'Archived', ' COMPLETED ', 'Draft'])('honors stored status %s', status => expect(summaryStatusLine(status, '2030-01-01')).toBe(status.trim().toLowerCase()));
it('formats date-only and exact instants without moving the LA calendar day', () => {
 expect(eventSummaryDate('2026-09-20', null)).toBe('Sun, Sep 20');
 expect(eventSummaryDate('', '2026-09-21T01:00:00Z')).toContain('Sep 20');
 expect(eventSummaryDate('2026-02-31', null)).toBe('Date to be set');
});
