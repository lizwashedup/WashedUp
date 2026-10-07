import { daysUntilLabel, deriveEventState, needsAttention, pickNextUpcomingEvent } from '../organizerHome';
import type { CommunityEventRow } from '../creatorMode';
const event = (event_date: string): CommunityEventRow => ({
 id: 'calendar-event', title: 'Saved gathering', event_date, status: 'Live',
 venue: null, public_name: null, image_url: null, community_id: null,
 goingCount: 2, ticketsSold: 0, tiers: [], roomArchived: null,
});
it.each([
 ['2026-09-19', '2026-09-19T16:59:00Z'],
 ['2026-03-08', '2026-03-08T16:00:00Z'],
 ['2026-11-01', '2026-11-01T17:00:00Z'],
])('keeps date-only %s on its LA calendar day, including DST changes', (date, now) => {
 const e = event(date);
 expect(deriveEventState(e, now)).toBe('live');
 expect(pickNextUpcomingEvent([e], now)?.id).toBe(e.id);
 expect(needsAttention(e, now)).toBe(false);
 expect(daysUntilLabel(date, now)).toBe('today');
});
it('keeps tomorrow and yesterday distinct across the month boundary', () => {
 const now = '2026-09-30T18:00:00Z';
 expect(daysUntilLabel('2026-10-01', now)).toBe('tomorrow');
 expect(deriveEventState(event('2026-09-29'), now)).toBe('ended');
 expect(needsAttention(event('2026-09-29'), now)).toBe(true);
});
it('still converts timestamp instants to LA instead of truncating their UTC date', () => {
 const e = event('2026-09-19T00:00:00Z');
 const now = '2026-09-19T16:59:00Z';
 expect(deriveEventState(e, now)).toBe('ended');
 expect(pickNextUpcomingEvent([e], now)).toBeNull();
});
