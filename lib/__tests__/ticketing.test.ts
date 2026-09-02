jest.mock('../supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

import { supabase } from '../supabase';
import {
  buildCheckoutBreakdown,
  computeFeePreview,
  getFailedPayouts,
  getOrganizationPurchases,
  getOrganizationReconciliation,
  getTierAvailability,
  isLowInventory,
  organizationPurchasesToCsv,
  purchaseStatusLabel,
  resolveOrderViewState,
  searchOrganizationPurchases,
  sumReconciliationRows,
  type EventReconciliationRow,
  type MyOrder,
  type OrganizationPurchase,
} from '../ticketing';
import type { PriceQuote } from '../ticketPromosAddons';

const mockRpc = supabase.rpc as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

// ─── buildCheckoutBreakdown (Scene design spec 05: itemized price) ────────

describe('buildCheckoutBreakdown without a server quote', () => {
  it('itemizes ticket face + processing fee, computed the same way the sheet already priced the total', () => {
    const lines = buildCheckoutBreakdown({
      tierName: 'general admission',
      qty: 2,
      tierPriceCents: 2000,
      addonTotalCents: 0,
      quote: null,
    });
    const preview = computeFeePreview(4000, 0);

    expect(lines.map((l) => l.key)).toEqual(['tickets', 'processing', 'total']);
    expect(lines[0]).toMatchObject({ label: 'general admission × 2', cents: 4000, emphasis: 'line' });
    expect(lines[1]).toMatchObject({ cents: preview.processingCents, emphasis: 'line' });
    expect(lines[2]).toMatchObject({ label: 'total', cents: preview.buyerTotalCents, emphasis: 'total' });
  });

  it('adds an extras line only when add-ons carry a real face value', () => {
    const withAddons = buildCheckoutBreakdown({
      tierName: 'vip', qty: 1, tierPriceCents: 5000, addonTotalCents: 1200, quote: null,
    });
    expect(withAddons.map((l) => l.key)).toEqual(['tickets', 'extras', 'processing', 'total']);
    expect(withAddons.find((l) => l.key === 'extras')).toMatchObject({ cents: 1200 });

    const withoutAddons = buildCheckoutBreakdown({
      tierName: 'vip', qty: 1, tierPriceCents: 5000, addonTotalCents: 0, quote: null,
    });
    expect(withoutAddons.find((l) => l.key === 'extras')).toBeUndefined();
  });

  it('never shows a discount line when there is no server quote', () => {
    const lines = buildCheckoutBreakdown({
      tierName: 'general admission', qty: 1, tierPriceCents: 3000, addonTotalCents: 0, quote: null,
    });
    expect(lines.find((l) => l.key === 'discount')).toBeUndefined();
  });
});

describe('buildCheckoutBreakdown with a server quote', () => {
  const quote: PriceQuote = {
    ok: true,
    faceCents: 1000,
    discountCents: 200,
    processingCents: 35,
    addonTotalCents: 500,
    totalCents: 1335,
    isFree: false,
    promoValid: true,
    promoReason: null,
    reason: null,
  };

  it('takes every number from the quote verbatim - money is never client math once the server priced it', () => {
    const lines = buildCheckoutBreakdown({
      tierName: 'general admission',
      qty: 1,
      // deliberately different from the quote, to prove the quote wins
      tierPriceCents: 999999,
      addonTotalCents: 999999,
      quote,
    });
    expect(lines.map((l) => l.key)).toEqual(['tickets', 'extras', 'discount', 'processing', 'total']);
    expect(lines.find((l) => l.key === 'tickets')).toMatchObject({ cents: 1000 });
    expect(lines.find((l) => l.key === 'extras')).toMatchObject({ cents: 500 });
    expect(lines.find((l) => l.key === 'discount')).toMatchObject({ cents: 200, emphasis: 'discount' });
    expect(lines.find((l) => l.key === 'processing')).toMatchObject({ cents: 35 });
    expect(lines.find((l) => l.key === 'total')).toMatchObject({ cents: 1335, emphasis: 'total' });
  });

  it('omits the discount line when the quote carries none', () => {
    const lines = buildCheckoutBreakdown({
      tierName: 'general admission', qty: 1, tierPriceCents: 1000, addonTotalCents: 0,
      quote: { ...quote, discountCents: 0 },
    });
    expect(lines.find((l) => l.key === 'discount')).toBeUndefined();
  });
});

// ─── resolveOrderViewState (Scene design spec 05: confirmation states) ────

function order(overrides: Partial<MyOrder>): MyOrder {
  return {
    id: 'order-1', event_id: 'event-1', qty: 1, total_cents: 0, status: 'paid',
    created_at: new Date().toISOString(), event_title: 'a party', event_date: null,
    event_start_time: null,
    event_image: null, event_venue: null, event_public_name: null, event_host_user_id: null,
    event_community_id: null,
    seats: [],
    ...overrides,
  };
}

describe('resolveOrderViewState', () => {
  it('is loading only while there is truly no order yet to show', () => {
    expect(resolveOrderViewState(null, true)).toEqual({ kind: 'loading' });
    expect(resolveOrderViewState(undefined, true)).toEqual({ kind: 'loading' });
  });

  it('falls to not_found once loading has settled with nothing (a bad link, or RLS)', () => {
    expect(resolveOrderViewState(null, false)).toEqual({ kind: 'not_found' });
  });

  it('reads status first: canceled and refunded orders never read as a live ticket', () => {
    expect(resolveOrderViewState(order({ status: 'canceled' }), false)).toEqual({ kind: 'canceled' });
    expect(resolveOrderViewState(order({ status: 'refunded' }), false)).toEqual({ kind: 'refunded' });
  });

  it('reads a still-pending checkout as pending regardless of seats', () => {
    expect(resolveOrderViewState(order({ status: 'pending', seats: [] }), false)).toEqual({ kind: 'pending' });
  });

  it('reads a paid order with no active seat yet as settling, not ready', () => {
    const settling = order({
      status: 'paid',
      seats: [{ id: 's1', position_index: 1, reference_code: 'ABC123', voided: true, checkedIn: false }],
    });
    expect(resolveOrderViewState(settling, false)).toEqual({ kind: 'settling' });
  });

  it('reads a paid order with at least one live seat as ready', () => {
    const ready = order({
      status: 'paid',
      seats: [
        { id: 's1', position_index: 1, reference_code: 'ABC123', voided: true, checkedIn: false },
        { id: 's2', position_index: 2, reference_code: 'DEF456', voided: false, checkedIn: false },
      ],
    });
    expect(resolveOrderViewState(ready, false)).toEqual({ kind: 'ready' });
  });

  it('prefers the fresh order over a stale isLoading flag from the previous query', () => {
    // react-query can hand back cached data while a background refetch is
    // still in flight; a real order in hand must never be shown as "loading".
    expect(resolveOrderViewState(order({ status: 'paid', seats: [{ id: 's1', position_index: 1, reference_code: 'X', voided: false, checkedIn: false }] }), true))
      .toEqual({ kind: 'ready' });
  });
});

// ─── isLowInventory / getTierAvailability (C-19/TK-07) ────────────────────

describe('isLowInventory', () => {
  it('is never low once nothing is left -- that is sold out, a different state', () => {
    expect(isLowInventory(0, 10)).toBe(false);
  });

  it('is never low on an uncapped tier (cap <= 0)', () => {
    expect(isLowInventory(5, 0)).toBe(false);
  });

  it('uses the 3-seat floor on a small cap', () => {
    // 20% of 10 is 2, but the floor is 3
    expect(isLowInventory(3, 10)).toBe(true);
    expect(isLowInventory(4, 10)).toBe(false);
  });

  it('scales past the floor on a large cap', () => {
    // 20% of 100 is 20
    expect(isLowInventory(20, 100)).toBe(true);
    expect(isLowInventory(21, 100)).toBe(false);
  });
});

// ─── getFailedPayouts (Build 35 Screen 01 exception surfacing) ────────────

describe('getFailedPayouts', () => {
  beforeEach(() => mockFrom.mockReset());

  it('returns nothing when the organizer has no events, without ever asking ticket_payouts', async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'explore_events') return eventsChain;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getFailedPayouts([], 'user-1');
    expect(result).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when none of the organizer\'s payouts have failed', async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({ data: [{ id: 'event-1', title: 'Comedy Night' }], error: null })),
    };
    const payoutsChain: any = {
      select: jest.fn(() => payoutsChain),
      in: jest.fn(() => payoutsChain),
      eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    mockFrom.mockImplementation((table: string) => (table === 'explore_events' ? eventsChain : payoutsChain));

    const result = await getFailedPayouts([], 'user-1');
    expect(result).toEqual([]);
  });

  it('maps a failed payout row to its real event title, never inventing one', async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({
        data: [{ id: 'event-1', title: 'Comedy Night' }, { id: 'event-2', title: 'Open Mic' }],
        error: null,
      })),
    };
    const payoutsChain: any = {
      select: jest.fn(() => payoutsChain),
      in: jest.fn(() => payoutsChain),
      eq: jest.fn(() => Promise.resolve({
        data: [{ event_id: 'event-1', failure_message: 'stripe transfer rejected' }],
        error: null,
      })),
    };
    mockFrom.mockImplementation((table: string) => (table === 'explore_events' ? eventsChain : payoutsChain));

    const result = await getFailedPayouts([], 'user-1');
    expect(result).toEqual([
      { eventId: 'event-1', eventTitle: 'Comedy Night', failureMessage: 'stripe transfer rejected' },
    ]);
    expect(payoutsChain.in).toHaveBeenCalledWith('event_id', ['event-1', 'event-2']);
    expect(payoutsChain.eq).toHaveBeenCalledWith('status', 'failed');
  });

  it('preserves a null failure_message rather than fabricating a reason', async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({ data: [{ id: 'event-1', title: 'Comedy Night' }], error: null })),
    };
    const payoutsChain: any = {
      select: jest.fn(() => payoutsChain),
      in: jest.fn(() => payoutsChain),
      eq: jest.fn(() => Promise.resolve({
        data: [{ event_id: 'event-1', failure_message: null }],
        error: null,
      })),
    };
    mockFrom.mockImplementation((table: string) => (table === 'explore_events' ? eventsChain : payoutsChain));

    const result = await getFailedPayouts([], 'user-1');
    expect(result).toEqual([{ eventId: 'event-1', eventTitle: 'Comedy Night', failureMessage: null }]);
  });

  it("scopes to the organizer's own events: host_user_id plus led communities", async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    mockFrom.mockImplementation(() => eventsChain);

    await getFailedPayouts(['community-1', 'community-2'], 'user-1');
    expect(eventsChain.or).toHaveBeenCalledWith('host_user_id.eq.user-1,community_id.in.(community-1,community-2)');
  });
});

// ─── Build 35 Screen 10: the organization-level ledger ───────────────────

function purchase(overrides: Partial<OrganizationPurchase> = {}): OrganizationPurchase {
  return {
    orderId: 'order-1',
    eventId: 'event-1',
    eventTitle: 'Comedy Night',
    buyerName: 'Ada Lovelace',
    tierName: 'General',
    qty: 1,
    totalCents: 2000,
    refundedCents: 0,
    status: 'paid',
    createdAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('getOrganizationPurchases', () => {
  beforeEach(() => mockFrom.mockReset());

  it('returns nothing when the organizer has no events, without ever asking ticket_orders', async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'explore_events') return eventsChain;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getOrganizationPurchases([], 'user-1');
    expect(result).toEqual([]);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("maps a purchase to its real event title and defaults a blank buyer name to 'guest'", async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({ data: [{ id: 'event-1', title: 'Comedy Night' }], error: null })),
    };
    const ordersChain: any = {
      select: jest.fn(() => ordersChain),
      in: jest.fn(() => ordersChain),
      order: jest.fn(() => Promise.resolve({
        data: [{
          id: 'order-1', event_id: 'event-1', buyer_name_snapshot: '   ', qty: 2,
          total_cents: 4000, refunded_cents: 0, status: 'paid', created_at: '2026-08-20T00:00:00.000Z',
          ticket_tiers: { name: 'General' },
        }],
        error: null,
      })),
    };
    mockFrom.mockImplementation((table: string) => (table === 'explore_events' ? eventsChain : ordersChain));

    const result = await getOrganizationPurchases([], 'user-1');
    expect(result).toEqual([{
      orderId: 'order-1', eventId: 'event-1', eventTitle: 'Comedy Night', buyerName: 'guest',
      tierName: 'General', qty: 2, totalCents: 4000, refundedCents: 0, status: 'paid',
      createdAt: '2026-08-20T00:00:00.000Z',
    }]);
    expect(ordersChain.in).toHaveBeenCalledWith('event_id', ['event-1']);
  });
});

describe('purchaseStatusLabel', () => {
  it('labels a fully refunded order as refunded regardless of refunded_cents', () => {
    expect(purchaseStatusLabel({ status: 'refunded', refundedCents: 0 })).toBe('refunded');
  });

  it('distinguishes a partial refund (still paid, some cents back) from a clean paid order', () => {
    expect(purchaseStatusLabel({ status: 'paid', refundedCents: 500 })).toBe('partial');
    expect(purchaseStatusLabel({ status: 'paid', refundedCents: 0 })).toBe('paid');
  });

  it('passes pending and canceled through as-is', () => {
    expect(purchaseStatusLabel({ status: 'pending', refundedCents: 0 })).toBe('pending');
    expect(purchaseStatusLabel({ status: 'canceled', refundedCents: 0 })).toBe('canceled');
  });
});

describe('searchOrganizationPurchases', () => {
  it('returns everything for a blank query', () => {
    const list = [purchase()];
    expect(searchOrganizationPurchases(list, '   ')).toEqual(list);
  });

  it('matches buyer name, event title, or tier name, case-insensitively', () => {
    const list = [
      purchase({ orderId: 'a', buyerName: 'Ada Lovelace' }),
      purchase({ orderId: 'b', buyerName: 'Grace Hopper', eventTitle: 'Open Mic' }),
    ];
    expect(searchOrganizationPurchases(list, 'ada').map((p) => p.orderId)).toEqual(['a']);
    expect(searchOrganizationPurchases(list, 'OPEN MIC').map((p) => p.orderId)).toEqual(['b']);
  });

  it('excludes purchases that match nothing', () => {
    expect(searchOrganizationPurchases([purchase()], 'nonexistent')).toEqual([]);
  });
});

describe('organizationPurchasesToCsv', () => {
  it('emits a header row plus one escaped row per purchase, using the derived status label', () => {
    const csv = organizationPurchasesToCsv([
      purchase({ buyerName: 'Jane "JJ" Doe', totalCents: 2550, refundedCents: 500, status: 'paid' }),
    ]);
    const [header, row] = csv.split('\n');
    expect(header).toBe('date,event,buyer,tier,qty,total,status,refunded');
    expect(row).toBe('"2026-08-20","Comedy Night","Jane ""JJ"" Doe","General",1,25.50,"partial",5.00');
  });
});

function reconRow(overrides: Partial<EventReconciliationRow> = {}): EventReconciliationRow {
  return {
    eventId: 'event-1', eventTitle: 'Comedy Night', ticketsSold: 1, grossFaceCents: 10000,
    processingCents: 500, commissionCents: 400, refundedCents: 0, netToYouCents: 9600,
    payoutStatus: null, ...overrides,
  };
}

describe('sumReconciliationRows', () => {
  it('returns the all-zero total for no events', () => {
    expect(sumReconciliationRows([])).toEqual({
      eventsCount: 0, ticketsSold: 0, grossFaceCents: 0, processingCents: 0,
      commissionCents: 0, refundedCents: 0, netToYouCents: 0,
    });
  });

  it('sums every field across events', () => {
    const rows = [
      reconRow(),
      reconRow({ eventId: 'event-2', ticketsSold: 2, grossFaceCents: 5000, commissionCents: 200, netToYouCents: 4800 }),
    ];
    expect(sumReconciliationRows(rows)).toEqual({
      eventsCount: 2, ticketsSold: 3, grossFaceCents: 15000, processingCents: 1000,
      commissionCents: 600, refundedCents: 0, netToYouCents: 14400,
    });
  });
});

describe('getOrganizationReconciliation', () => {
  beforeEach(() => mockFrom.mockReset());

  it('returns empty rows and an all-zero total when the organizer has no events', async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'explore_events') return eventsChain;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getOrganizationReconciliation([], 'user-1');
    expect(result).toEqual({
      rows: [],
      totals: {
        eventsCount: 0, ticketsSold: 0, grossFaceCents: 0, processingCents: 0,
        commissionCents: 0, refundedCents: 0, netToYouCents: 0,
      },
    });
  });

  it("rolls up one event's Screen 07 numbers (getEventMoneySummary + getEventAttendees) into a matching Organization total", async () => {
    const eventsChain: any = {
      select: jest.fn(() => eventsChain),
      or: jest.fn(() => Promise.resolve({ data: [{ id: 'event-1', title: 'Comedy Night' }], error: null })),
    };
    const ordersChain: any = {
      select: jest.fn(() => ordersChain),
      eq: jest.fn(() => Promise.resolve({
        data: [{ face_cents: 10000, processing_cents: 500, commission_cents: 400, status: 'paid' }],
        error: null,
      })),
    };
    const payoutsChain: any = {
      select: jest.fn(() => payoutsChain),
      eq: jest.fn(() => payoutsChain),
      maybeSingle: jest.fn(() => Promise.resolve({
        data: { status: 'released', released_at: '2026-08-20', paid_at: null },
        error: null,
      })),
    };
    const positionsChain: any = {
      select: jest.fn(() => positionsChain),
      eq: jest.fn(() => positionsChain),
      order: jest.fn(() => Promise.resolve({
        data: [{
          id: 'position-1', position_index: 1, reference_code: 'SEAT-ONE', voided_at: null, refunded_cents: 300,
          ticket_orders: { id: 'order-1', event_id: 'event-1', buyer_name_snapshot: 'Ada', status: 'paid', ticket_tiers: { name: 'GA' } },
          ticket_checkins: [],
        }],
        error: null,
      })),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'explore_events') return eventsChain;
      if (table === 'ticket_orders') return ordersChain;
      if (table === 'ticket_payouts') return payoutsChain;
      if (table === 'ticket_order_positions') return positionsChain;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getOrganizationReconciliation([], 'user-1');
    expect(result.rows).toEqual([{
      eventId: 'event-1', eventTitle: 'Comedy Night', ticketsSold: 1,
      grossFaceCents: 10000, processingCents: 500, commissionCents: 400,
      refundedCents: 300, netToYouCents: 9300, payoutStatus: 'released',
    }]);
    expect(result.totals).toEqual({
      eventsCount: 1, ticketsSold: 1, grossFaceCents: 10000, processingCents: 500,
      commissionCents: 400, refundedCents: 300, netToYouCents: 9300,
    });
  });
});

describe('getTierAvailability', () => {
  beforeEach(() => mockRpc.mockReset());

  it('returns an empty map without calling the RPC for an empty tier list', async () => {
    const result = await getTierAvailability([]);
    expect(result.size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('keys the result by tier id, one RPC call per tier', async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });
    mockRpc.mockResolvedValueOnce({ data: 12, error: null });
    const result = await getTierAvailability(['tier-a', 'tier-b']);
    expect(result.get('tier-a')).toBe(3);
    expect(result.get('tier-b')).toBe(12);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'get_ticket_tier_availability', { p_tier_id: 'tier-a' });
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'get_ticket_tier_availability', { p_tier_id: 'tier-b' });
  });

  it('omits a tier whose RPC call fails, rather than guessing a count', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('boom') });
    const result = await getTierAvailability(['tier-a']);
    expect(result.has('tier-a')).toBe(false);
  });
});
