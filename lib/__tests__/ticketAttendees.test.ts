const mockFrom = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: mockFrom } }));

const { countAttendees, getEventAttendees, isLiveSeat, sumRefundedCentsOnPaidOrders } = require('../ticketAttendees');

function attendee(overrides: Record<string, unknown> = {}) {
  return {
    positionId: 'position-1',
    orderId: 'order-1',
    positionIndex: 1,
    referenceCode: 'SEAT-ONE',
    buyerName: 'guest',
    tierName: null,
    orderStatus: 'paid',
    voided: false,
    refundedCents: 0,
    checkedIn: false,
    ...overrides,
  };
}

beforeEach(() => mockFrom.mockReset());

describe('ticket attendee data contract', () => {
  it('reads seat references for only the requested event and projects no contact fields', async () => {
    const calls: unknown[] = [];
    const chain: any = {
      select: jest.fn((value) => { calls.push(['select', value]); return chain; }),
      eq: jest.fn((...args) => { calls.push(['eq', ...args]); return chain; }),
      order: jest.fn((...args) => {
        calls.push(['order', ...args]);
        return Promise.resolve({
          data: [{
            id: 'position-1',
            position_index: 1,
            reference_code: 'SEAT-ONE',
            voided_at: null,
            refunded_cents: 0,
            ticket_orders: {
              id: 'order-1', event_id: 'event-one', buyer_name_snapshot: ' Ada ', status: 'paid',
              ticket_tiers: { name: 'General' },
            },
            ticket_checkins: [{ result: 'admitted' }],
          }],
          error: null,
        });
      }),
    };
    mockFrom.mockReturnValue(chain);

    const rows = await getEventAttendees('event-one');
    expect(mockFrom).toHaveBeenCalledWith('ticket_order_positions');
    expect(calls).toContainEqual(['eq', 'ticket_orders.event_id', 'event-one']);
    expect(calls).toContainEqual(['order', 'position_index', { ascending: true }]);
    const select = String((calls.find((call: any) => call[0] === 'select') as any)[1]);
    expect(select).toContain('reference_code');
    expect(select).not.toMatch(/email|phone/);
    expect(rows).toEqual([expect.objectContaining({
      referenceCode: 'SEAT-ONE', buyerName: 'Ada', checkedIn: true,
    })]);
  });

  it('counts only paid non-voided seats as live admission capacity', () => {
    const rows = [
      attendee({ checkedIn: true }),
      attendee({ positionId: 'position-2', voided: true, refundedCents: 100 }),
      attendee({ positionId: 'position-3', orderStatus: 'pending' }),
      attendee({ positionId: 'position-4' }),
    ];
    expect(isLiveSeat(rows[0])).toBe(true);
    expect(isLiveSeat(rows[1])).toBe(false);
    expect(countAttendees(rows)).toEqual({ sold: 2, checkedIn: 1, refunded: 1 });
  });

  it('sums refunds for the money summary only from still-paid orders', () => {
    const rows = [
      // partial refund on a paid order: counts (gross still includes the order)
      attendee({ positionId: 'p1', orderStatus: 'paid', refundedCents: 1500 }),
      // fully refunded order: its gross/commission already left the summary,
      // so its refunded cents must NOT be subtracted a second time
      attendee({ positionId: 'p2', orderStatus: 'refunded', refundedCents: 5000 }),
      attendee({ positionId: 'p3', orderStatus: 'paid', refundedCents: 0 }),
    ];
    expect(sumRefundedCentsOnPaidOrders(rows)).toBe(1500);
  });
});
