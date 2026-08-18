import {
  buildCheckoutBreakdown,
  computeFeePreview,
  resolveOrderViewState,
  type MyOrder,
} from '../ticketing';
import type { PriceQuote } from '../ticketPromosAddons';

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
    event_image: null, event_venue: null, event_public_name: null, event_host_user_id: null,
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
      seats: [{ id: 's1', position_index: 1, reference_code: 'ABC123', voided: true }],
    });
    expect(resolveOrderViewState(settling, false)).toEqual({ kind: 'settling' });
  });

  it('reads a paid order with at least one live seat as ready', () => {
    const ready = order({
      status: 'paid',
      seats: [
        { id: 's1', position_index: 1, reference_code: 'ABC123', voided: true },
        { id: 's2', position_index: 2, reference_code: 'DEF456', voided: false },
      ],
    });
    expect(resolveOrderViewState(ready, false)).toEqual({ kind: 'ready' });
  });

  it('prefers the fresh order over a stale isLoading flag from the previous query', () => {
    // react-query can hand back cached data while a background refetch is
    // still in flight; a real order in hand must never be shown as "loading".
    expect(resolveOrderViewState(order({ status: 'paid', seats: [{ id: 's1', position_index: 1, reference_code: 'X', voided: false }] }), true))
      .toEqual({ kind: 'ready' });
  });
});
