import {
  daysUntilLabel,
  deriveEventState,
  failedPayoutLabel,
  hasUnpublishedTickets,
  inventoryLabel,
  needsAttention,
  pickNextUpcomingEvent,
  sumTierCapacity,
} from '../organizerHome';
import type { CommunityEventRow } from '../creatorMode';
import type { TicketTier } from '../ticketing';

function event(overrides: Partial<CommunityEventRow> = {}): CommunityEventRow {
  return {
    id: 'event-1',
    title: 'Comedy night',
    event_date: '2026-09-01T02:00:00.000Z',
    venue: 'The Lot',
    status: 'Live',
    public_name: null,
    image_url: null,
    community_id: null,
    goingCount: 0,
    ticketsSold: 0,
    tiers: [],
    roomArchived: null,
    ...overrides,
  };
}

function tier(overrides: Partial<TicketTier> = {}): Pick<TicketTier, 'quantity_cap' | 'status'> {
  return { quantity_cap: 50, status: 'on_sale', ...overrides };
}

describe('pickNextUpcomingEvent', () => {
  const now = '2026-08-18T12:00:00.000Z'; // Aug 18, LA morning

  it('picks the earliest Live event on or after today', () => {
    const events = [
      event({ id: 'later', event_date: '2026-09-10T02:00:00.000Z' }),
      event({ id: 'sooner', event_date: '2026-08-25T02:00:00.000Z' }),
    ];
    expect(pickNextUpcomingEvent(events, now)?.id).toBe('sooner');
  });

  it('ignores events that are not Live', () => {
    const events = [event({ id: 'draft', status: 'Draft', event_date: '2026-08-19T02:00:00.000Z' })];
    expect(pickNextUpcomingEvent(events, now)).toBeNull();
  });

  it('ignores events with a past date', () => {
    const events = [event({ id: 'past', event_date: '2026-01-01T02:00:00.000Z' })];
    expect(pickNextUpcomingEvent(events, now)).toBeNull();
  });

  it('ignores events with no date', () => {
    const events = [event({ id: 'nodate', event_date: null })];
    expect(pickNextUpcomingEvent(events, now)).toBeNull();
  });

  it('treats an event happening today as upcoming', () => {
    // LA is UTC-7 in August; 2026-08-18T12:00Z is still Aug 18 in LA
    const events = [event({ id: 'today', event_date: '2026-08-18T20:00:00.000Z' })];
    expect(pickNextUpcomingEvent(events, now)?.id).toBe('today');
  });

  it('returns null for an empty list', () => {
    expect(pickNextUpcomingEvent([], now)).toBeNull();
  });
});

describe('sumTierCapacity', () => {
  it('sums capacity across offered tiers', () => {
    expect(sumTierCapacity([tier({ quantity_cap: 50 }), tier({ quantity_cap: 25 })])).toBe(75);
  });

  it('returns null when any offered tier has no cap', () => {
    expect(sumTierCapacity([tier({ quantity_cap: 50 }), tier({ quantity_cap: null })])).toBeNull();
  });

  it('ignores draft tiers entirely, including their cap', () => {
    expect(
      sumTierCapacity([tier({ quantity_cap: 50 }), tier({ quantity_cap: null, status: 'draft' })]),
    ).toBe(50);
  });

  it('ignores closed tiers because they are no longer offered', () => {
    expect(sumTierCapacity([tier({ quantity_cap: 50, status: 'closed' })])).toBeNull();
  });

  it('returns null when there are no offered tiers', () => {
    expect(sumTierCapacity([tier({ status: 'draft' })])).toBeNull();
    expect(sumTierCapacity([])).toBeNull();
  });
});

describe('inventoryLabel', () => {
  it('shows a real denominator when capacity is known', () => {
    expect(inventoryLabel(12, 60)).toBe('12 of 60 tickets sold');
  });

  it('shows the honest count alone when capacity is open-ended', () => {
    expect(inventoryLabel(12, null)).toBe('12 tickets sold');
  });

  it('singularizes one ticket', () => {
    expect(inventoryLabel(1, null)).toBe('1 ticket sold');
  });

  it('never fabricates a denominator for zero sold', () => {
    expect(inventoryLabel(0, null)).toBe('0 tickets sold');
  });
});

describe('daysUntilLabel', () => {
  const now = '2026-08-18T12:00:00.000Z';

  it('says today for the same LA day', () => {
    expect(daysUntilLabel('2026-08-18T20:00:00.000Z', now)).toBe('today');
  });

  it('says tomorrow for the next LA day', () => {
    expect(daysUntilLabel('2026-08-19T20:00:00.000Z', now)).toBe('tomorrow');
  });

  it('counts days out beyond tomorrow', () => {
    expect(daysUntilLabel('2026-08-25T02:00:00.000Z', now)).toBe('in 6 days');
  });

  it('never returns a negative count for a same-day-but-earlier-UTC time', () => {
    // regression guard: a naive raw-ms diff could go negative near a day
    // boundary even though both instants land on the same LA calendar day
    expect(daysUntilLabel('2026-08-18T01:00:00.000Z', now)).toBe('today');
  });
});

describe('deriveEventState', () => {
  const now = '2026-08-18T12:00:00.000Z'; // Aug 18, LA morning

  it('reads the terminal/admin statuses verbatim, date irrelevant', () => {
    expect(deriveEventState(event({ status: 'Cancelled', event_date: '2026-09-01T02:00:00.000Z' }), now)).toBe('cancelled');
    expect(deriveEventState(event({ status: 'Archived', event_date: '2026-01-01T02:00:00.000Z' }), now)).toBe('archived');
    expect(deriveEventState(event({ status: 'Completed', event_date: '2026-01-01T02:00:00.000Z' }), now)).toBe('ended');
    expect(deriveEventState(event({ status: 'Draft', event_date: '2026-09-01T02:00:00.000Z' }), now)).toBe('draft');
  });

  it('treats a dateless Live event as scheduled', () => {
    expect(deriveEventState(event({ status: 'Live', event_date: null }), now)).toBe('scheduled');
  });

  it('is ended when still Live but the date already passed -- nobody closed it out', () => {
    expect(deriveEventState(event({ status: 'Live', event_date: '2026-08-01T02:00:00.000Z' }), now)).toBe('ended');
  });

  it('is live on the day itself, regardless of ticket state', () => {
    expect(
      deriveEventState(
        event({ status: 'Live', event_date: '2026-08-18T20:00:00.000Z', tiers: [{ quantity_cap: 10, status: 'on_sale' }], ticketsSold: 10 }),
        now,
      ),
    ).toBe('live');
  });

  it('is sold_out for a future event whose offered capacity is fully claimed', () => {
    expect(
      deriveEventState(
        event({ status: 'Live', event_date: '2026-09-01T02:00:00.000Z', tiers: [{ quantity_cap: 50, status: 'on_sale' }], ticketsSold: 50 }),
        now,
      ),
    ).toBe('sold_out');
  });

  it('is on_sale for a future event with an open on_sale tier', () => {
    expect(
      deriveEventState(
        event({ status: 'Live', event_date: '2026-09-01T02:00:00.000Z', tiers: [{ quantity_cap: 50, status: 'on_sale' }], ticketsSold: 12 }),
        now,
      ),
    ).toBe('on_sale');
  });

  it('is scheduled for a future event with no tiers at all (RSVP-only)', () => {
    expect(deriveEventState(event({ status: 'Live', event_date: '2026-09-01T02:00:00.000Z', tiers: [] }), now)).toBe('scheduled');
  });

  it('is scheduled, not on_sale, when every tier is still a draft', () => {
    expect(
      deriveEventState(
        event({ status: 'Live', event_date: '2026-09-01T02:00:00.000Z', tiers: [{ quantity_cap: 50, status: 'draft' }] }),
        now,
      ),
    ).toBe('scheduled');
  });

  it('is scheduled, not sold_out, when every tier is closed', () => {
    expect(
      deriveEventState(
        event({ status: 'Live', event_date: '2026-09-01T02:00:00.000Z', tiers: [{ quantity_cap: 50, status: 'closed' }], ticketsSold: 50 }),
        now,
      ),
    ).toBe('scheduled');
  });
});

describe('needsAttention', () => {
  const now = '2026-08-18T12:00:00.000Z'; // Aug 18, LA morning

  it('flags an overdue draft', () => {
    expect(needsAttention(event({ status: 'Draft', event_date: '2026-08-01T02:00:00.000Z' }), now)).toBe(true);
  });

  it('does not flag a draft with a future date', () => {
    expect(needsAttention(event({ status: 'Draft', event_date: '2026-09-01T02:00:00.000Z' }), now)).toBe(false);
  });

  it('does not flag a draft with no date', () => {
    expect(needsAttention(event({ status: 'Draft', event_date: null }), now)).toBe(false);
  });

  it('flags a Live event whose date passed and was never closed out', () => {
    expect(needsAttention(event({ status: 'Live', event_date: '2026-08-01T02:00:00.000Z' }), now)).toBe(true);
  });

  it('flags a Live event today with zero going and zero sold', () => {
    expect(needsAttention(event({ status: 'Live', event_date: '2026-08-18T20:00:00.000Z', goingCount: 0, ticketsSold: 0 }), now)).toBe(true);
  });

  it('flags a Live event 2 days out with zero interest, but not 3 days out', () => {
    expect(needsAttention(event({ status: 'Live', event_date: '2026-08-20T20:00:00.000Z', goingCount: 0, ticketsSold: 0 }), now)).toBe(true);
    expect(needsAttention(event({ status: 'Live', event_date: '2026-08-21T20:00:00.000Z', goingCount: 0, ticketsSold: 0 }), now)).toBe(false);
  });

  it('does not flag a soon event that already has RSVPs or sales', () => {
    expect(needsAttention(event({ status: 'Live', event_date: '2026-08-18T20:00:00.000Z', goingCount: 1, ticketsSold: 0 }), now)).toBe(false);
    expect(needsAttention(event({ status: 'Live', event_date: '2026-08-18T20:00:00.000Z', goingCount: 0, ticketsSold: 1 }), now)).toBe(false);
  });

  it('never flags Cancelled, Completed, or Archived events', () => {
    expect(needsAttention(event({ status: 'Cancelled', event_date: '2026-08-01T02:00:00.000Z' }), now)).toBe(false);
    expect(needsAttention(event({ status: 'Completed', event_date: '2026-08-01T02:00:00.000Z' }), now)).toBe(false);
    expect(needsAttention(event({ status: 'Archived', event_date: '2026-08-01T02:00:00.000Z' }), now)).toBe(false);
  });
});

describe('failedPayoutLabel', () => {
  it('singularizes one payout', () => {
    expect(failedPayoutLabel(1)).toBe('1 payout needs attention');
  });

  it('pluralizes multiple payouts', () => {
    expect(failedPayoutLabel(2)).toBe('2 payouts need attention');
  });
});

describe('hasUnpublishedTickets', () => {
  it('is false for a free/RSVP event with no tiers at all', () => {
    expect(hasUnpublishedTickets([])).toBe(false);
  });

  it('is true when every tier is still a draft', () => {
    expect(hasUnpublishedTickets([tier({ status: 'draft' })])).toBe(true);
  });

  it('is false once at least one tier is on sale', () => {
    expect(hasUnpublishedTickets([tier({ status: 'draft' }), tier({ status: 'on_sale' })])).toBe(false);
  });

  it('is false when sold out (on_sale tiers exist, just exhausted)', () => {
    expect(hasUnpublishedTickets([tier({ status: 'on_sale' })])).toBe(false);
  });

  it('is false when every tier already closed -- a finished sale is not a draft', () => {
    expect(hasUnpublishedTickets([tier({ status: 'closed' })])).toBe(false);
  });

  it('is true for a mix of closed and draft tiers -- the draft one is real', () => {
    expect(hasUnpublishedTickets([tier({ status: 'closed' }), tier({ status: 'draft' })])).toBe(true);
  });
});
