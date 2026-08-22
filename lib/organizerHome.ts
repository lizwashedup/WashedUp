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

/** Calendar days from now to eventDateISO, LA-day-boundary aware. Negative = past. */
function dayDiff(eventDateISO: string, nowISO: string): number {
  const now = getLADayParts(nowISO);
  const then = getLADayParts(eventDateISO);
  const nowUTC = Date.UTC(now.y, now.m, now.d);
  const thenUTC = Date.UTC(then.y, then.m, then.d);
  return Math.round((thenUTC - nowUTC) / 86400000);
}

/**
 * A short "when" for the urgency card: today / tomorrow / in N days. Both
 * dates are read on the LA calendar (matching formatEventDateLA) so this
 * agrees with the date printed next to it regardless of device timezone.
 */
export function daysUntilLabel(eventDateISO: string, nowISO: string = new Date().toISOString()): string {
  const diffDays = dayDiff(eventDateISO, nowISO);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  return `in ${diffDays} days`;
}

/** The 8-word event-state vocabulary the C-16 events list derives every card from. */
export type EventState =
  | 'draft'
  | 'scheduled'
  | 'on_sale'
  | 'sold_out'
  | 'live'
  | 'ended'
  | 'cancelled'
  | 'archived';

type EventStateFields = Pick<CommunityEventRow, 'status' | 'event_date'> & {
  tiers: Pick<TicketTier, 'quantity_cap' | 'status'>[];
  goingCount: number;
  ticketsSold: number;
};

/**
 * C-16: one state per event, priority-ordered so every event lands in
 * exactly one bucket. `status` carries the terminal/admin states
 * (Cancelled/Archived/Completed/Draft) verbatim -- confirmed live values,
 * see app/admin/events.tsx (Archived) and app/creator/event-form.tsx
 * (handleStatus, Completed/Cancelled). A still-'Live' event whose date has
 * already passed also resolves to 'ended': nothing marks that automatically,
 * so this is the only way a forgotten show stops reading as upcoming.
 */
export function deriveEventState(e: EventStateFields, nowISO: string = new Date().toISOString()): EventState {
  if (e.status === 'Cancelled') return 'cancelled';
  if (e.status === 'Archived') return 'archived';
  if (e.status === 'Completed') return 'ended';
  if (e.status === 'Draft') return 'draft';
  if (!e.event_date) return 'scheduled';
  const diffDays = dayDiff(e.event_date, nowISO);
  if (diffDays < 0) return 'ended';
  if (diffDays === 0) return 'live';
  const capacity = sumTierCapacity(e.tiers);
  if (capacity != null && e.tiers.length > 0 && e.ticketsSold >= capacity) return 'sold_out';
  if (e.tiers.some((t) => t.status === 'on_sale')) return 'on_sale';
  return 'scheduled';
}

/**
 * C-16: a real product decision this repo never wrote down, so this is a
 * reasonable proposal, not a confirmed spec -- a draft past its date, OR a
 * live event within 2 days of start with zero RSVPs/purchases (day-granular,
 * matching this file's own daysUntilLabel precision rather than fetching a
 * new start_time column for a true 48h window), OR a live event whose date
 * has already passed but was never marked Completed/Cancelled.
 */
export function needsAttention(e: EventStateFields, nowISO: string = new Date().toISOString()): boolean {
  if (!e.event_date) return false;
  const diffDays = dayDiff(e.event_date, nowISO);
  if (e.status === 'Draft') return diffDays < 0;
  if (e.status !== 'Live') return false;
  if (diffDays < 0) return true;
  return diffDays <= 2 && e.goingCount === 0 && e.ticketsSold === 0;
}
