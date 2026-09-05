const mockFrom = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: mockFrom } }));

const {
  answerToString,
  attachAnswers,
  countAttendees,
  getEventAnswers,
  getEventAttendees,
  getEventQuestions,
  isLiveSeat,
  sumRefundedCentsOnPaidOrders,
} = require('../ticketAttendees');

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
    pricePaidCents: 0,
    checkedInAt: null,
    purchasedAt: null,
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

describe('answerToString', () => {
  it('extracts text for short_text and paragraph', () => {
    expect(answerToString('short_text', { text: 'peanut allergy' })).toBe('peanut allergy');
    expect(answerToString('paragraph', { text: 'a longer note' })).toBe('a longer note');
  });

  it('extracts choice for single_select and dropdown', () => {
    expect(answerToString('single_select', { choice: 'vegetarian' })).toBe('vegetarian');
    expect(answerToString('dropdown', { choice: 'small' })).toBe('small');
  });

  it('joins choices for multi_select', () => {
    expect(answerToString('multi_select', { choices: ['vegan', 'gluten-free'] })).toBe('vegan, gluten-free');
  });

  it('formats terms as accepted (with date) or not accepted', () => {
    expect(answerToString('terms', { accepted: true, accepted_at: '2026-09-01' })).toBe('accepted 2026-09-01');
    expect(answerToString('terms', { accepted: false })).toBe('not accepted');
  });

  it('returns an empty string for null or malformed values', () => {
    expect(answerToString('short_text', null)).toBe('');
    expect(answerToString('short_text', { choice: 'wrong shape for this qtype' })).toBe('');
  });
});

describe('attachAnswers', () => {
  const questions = [
    { id: 'q-order', prompt: 'plus one name?', qtype: 'short_text', scope: 'per_order', sortOrder: 0 },
    { id: 'q-attendee', prompt: 'dietary restriction?', qtype: 'short_text', scope: 'per_attendee', sortOrder: 1 },
  ];
  const seats = [
    attendee({ positionId: 'p1', orderId: 'order-1', positionIndex: 1 }),
    attendee({ positionId: 'p2', orderId: 'order-1', positionIndex: 2 }),
  ];

  it('attaches a per_order answer (attendee_index null) to every seat of that order', () => {
    const rows = [{ orderId: 'order-1', questionId: 'q-order', attendeeIndex: null, value: { text: 'Sam' } }];
    const result = attachAnswers(seats, questions, rows);
    expect(result[0].answers['q-order']).toBe('Sam');
    expect(result[1].answers['q-order']).toBe('Sam');
  });

  it('attaches a per_attendee answer to only the seat whose position_index matches', () => {
    const rows = [
      { orderId: 'order-1', questionId: 'q-attendee', attendeeIndex: 1, value: { text: 'vegan' } },
      { orderId: 'order-1', questionId: 'q-attendee', attendeeIndex: 2, value: { text: 'none' } },
    ];
    const result = attachAnswers(seats, questions, rows);
    expect(result[0].answers['q-attendee']).toBe('vegan');
    expect(result[1].answers['q-attendee']).toBe('none');
  });

  it('never attaches an answer belonging to a different order', () => {
    const rows = [{ orderId: 'order-OTHER', questionId: 'q-order', attendeeIndex: null, value: { text: 'x' } }];
    const result = attachAnswers(seats, questions, rows);
    expect(result[0].answers).toEqual({});
    expect(result[1].answers).toEqual({});
  });

  it('ignores an answer for a question that is not in the active list (BR-2)', () => {
    const rows = [{ orderId: 'order-1', questionId: 'retired-question', attendeeIndex: null, value: { text: 'x' } }];
    const result = attachAnswers(seats, questions, rows);
    expect(result[0].answers).toEqual({});
  });
});

describe('getEventQuestions', () => {
  it('reads only active questions for the event, ordered by sort_order', async () => {
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => Promise.resolve({
        data: [{ id: 'q1', prompt: 'plus one?', qtype: 'short_text', scope: 'per_order', sort_order: 0 }],
        error: null,
      })),
    };
    mockFrom.mockReturnValue(chain);

    const rows = await getEventQuestions('event-1');
    expect(mockFrom).toHaveBeenCalledWith('ticket_questions');
    expect(chain.eq).toHaveBeenCalledWith('is_active', true);
    expect(rows).toEqual([{ id: 'q1', prompt: 'plus one?', qtype: 'short_text', scope: 'per_order', sortOrder: 0 }]);
  });

  it('returns an empty list on a read error rather than throwing', async () => {
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    };
    mockFrom.mockReturnValue(chain);

    expect(await getEventQuestions('event-1')).toEqual([]);
  });
});

describe('getEventAnswers', () => {
  it('returns an empty list without a network call when there are no order ids', async () => {
    expect(await getEventAnswers([])).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('reads answers scoped to the given order ids', async () => {
    const chain: any = {
      select: jest.fn(() => chain),
      in: jest.fn(() => Promise.resolve({
        data: [{ order_id: 'order-1', question_id: 'q1', attendee_index: null, value: { text: 'Sam' } }],
        error: null,
      })),
    };
    mockFrom.mockReturnValue(chain);

    const rows = await getEventAnswers(['order-1']);
    expect(mockFrom).toHaveBeenCalledWith('ticket_answers');
    expect(chain.in).toHaveBeenCalledWith('order_id', ['order-1']);
    expect(rows).toEqual([{ orderId: 'order-1', questionId: 'q1', attendeeIndex: null, value: { text: 'Sam' } }]);
  });

  it('returns an empty list on a read error rather than throwing', async () => {
    const chain: any = {
      select: jest.fn(() => chain),
      in: jest.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    };
    mockFrom.mockReturnValue(chain);

    expect(await getEventAnswers(['order-1'])).toEqual([]);
  });
});
