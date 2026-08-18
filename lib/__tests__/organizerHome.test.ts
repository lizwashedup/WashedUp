import {
  daysUntilLabel,
  inventoryLabel,
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
