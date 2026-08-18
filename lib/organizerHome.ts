/**
 * Pure logic for the organizer/producer home dashboard (CTO scope item 06;
 * inventory row O-01 "Native Producer Space home": "Producer/model header ->
 * show urgency -> live inventory -> ... -> Create organization event").
 *
 * Extracted from the screen so the picks/labels are unit-testable without
 * touching Supabase, matching this repo's established pattern (see
 * components/scene/SceneDiscovery.tsx + its __tests__ file, lib/eventRsvp.ts).
 *
 * O-09 applies here too: no "host" language, no community/member/join/door/
 * room concepts. This module only knows about events, tiers, and tickets.
 */

import { getLADayParts } from './laDate';
import type { CommunityEventRow } from './creatorMode';
import type { TicketTier } from './ticketing';

function laDayNumber(when: string): number {
  const { y, m, d } = getLADayParts(when);
  return y * 10000 + (m + 1) * 100 + d;
}

/**
 * The next Live event with a real, non-past date, earliest first. An event
 * with no date or a date already past never surfaces as "the next show" -
 * the home screen has nothing honest to say about it as urgency.
 */
export function pickNextUpcomingEvent(
  events: CommunityEventRow[],
  nowISO: string = new Date().toISOString(),
): CommunityEventRow | null {
  const todayNum = laDayNumber(nowISO);
  const upcoming = events
    .filter((e): e is CommunityEventRow & { event_date: string } => e.status === 'Live' && !!e.event_date)
    .filter((e) => laDayNumber(e.event_date) >= todayNum)
    .sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0));
  return upcoming[0] ?? null;
}

/**
 * Total offered capacity across an event's active ticket tiers. Null means
 * the event is open-ended (at least one offered tier has no cap): the caller
 * should show the sold count alone rather than inventing a denominator.
 * Draft tiers are not yet on sale and do not count as "offered".
 */
export function sumTierCapacity(tiers: Pick<TicketTier, 'quantity_cap' | 'status'>[]): number | null {
  const offered = tiers.filter((t) => t.status !== 'draft');
  if (offered.length === 0) return null;
  let total = 0;
  for (const t of offered) {
    if (t.quantity_cap == null) return null;
    total += t.quantity_cap;
  }
  return total;
}

/**
 * "X of Y tickets sold" with a real denominator, or the honest count alone
 * when the event has no fixed cap. Never a fabricated percentage.
 */
export function inventoryLabel(sold: number, capacity: number | null): string {
  const soldWord = sold === 1 ? 'ticket' : 'tickets';
  if (capacity == null) return `${sold} ${soldWord} sold`;
  return `${sold} of ${capacity} tickets sold`;
}

/**
 * A short "when" for the urgency card: today / tomorrow / in N days. Both
 * dates are read on the LA calendar (matching formatEventDateLA) so this
 * agrees with the date printed next to it regardless of device timezone.
 */
export function daysUntilLabel(eventDateISO: string, nowISO: string = new Date().toISOString()): string {
  const now = getLADayParts(nowISO);
  const then = getLADayParts(eventDateISO);
  const nowUTC = Date.UTC(now.y, now.m, now.d);
  const thenUTC = Date.UTC(then.y, then.m, then.d);
  const diffDays = Math.round((thenUTC - nowUTC) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return `in ${diffDays} days`;
}
