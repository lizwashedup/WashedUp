import { computeNetToYouCents, headline } from '../MoneySummaryCard';
import type { EventMoneySummary } from '../../../lib/ticketAttendees';

function money(overrides: Partial<EventMoneySummary> = {}): EventMoneySummary {
  return {
    grossFaceCents: 10000,
    processingCents: 300,
    commissionCents: 400,
    payoutStatus: null,
    payoutReleasedAt: null,
    payoutPaidAt: null,
    ...overrides,
  } as EventMoneySummary;
}

describe('computeNetToYouCents', () => {
  it('is gross face minus our commission minus refunds', () => {
    expect(computeNetToYouCents(money({ grossFaceCents: 10000, commissionCents: 400 }), 0)).toBe(9600);
  });

  it('subtracts refunds on top of the commission', () => {
    expect(computeNetToYouCents(money({ grossFaceCents: 10000, commissionCents: 400 }), 1500)).toBe(8100);
  });

  it('never nets in card processing, only face and commission', () => {
    // processingCents intentionally does not appear in the formula (matches
    // web's own held §6 formula, shown as its own separate row instead)
    const withHighProcessing = computeNetToYouCents(money({ grossFaceCents: 10000, commissionCents: 400, processingCents: 9000 }), 0);
    expect(withHighProcessing).toBe(9600);
  });
});

describe('headline', () => {
  it('leads with paid-out once payoutPaidAt is set, even if released is also set', () => {
    // T20:00Z, not midnight UTC, so the calendar day holds in western-US
    // timezones too (same fixture pattern as lib/__tests__/organizerHome.test.ts)
    const m = money({ payoutStatus: 'released', payoutReleasedAt: '2026-08-10T20:00:00.000Z', payoutPaidAt: '2026-08-12T20:00:00.000Z' });
    expect(headline(m, 9600)).toBe('paid out August 12. $96.00 is yours and settled.');
  });

  it('reports released-and-on-its-way when released but not yet paid', () => {
    const m = money({ payoutStatus: 'released', payoutReleasedAt: '2026-08-10T20:00:00.000Z' });
    expect(headline(m, 9600)).toBe('your payout of $96.00 released August 10 and is on its way to your bank.');
  });

  it('treats a payoutReleasedAt with no explicit status the same as released', () => {
    const m = money({ payoutStatus: null, payoutReleasedAt: '2026-08-10T20:00:00.000Z' });
    expect(headline(m, 9600)).toContain('released August 10');
  });

  it('reassures on a failed payout without alarming language', () => {
    const m = money({ payoutStatus: 'failed' });
    expect(headline(m, 9600)).toBe('a payout did not go through. we are on it; nothing is lost.');
  });

  it('defaults to the pre-payout future-tense message', () => {
    const m = money();
    expect(headline(m, 9600)).toBe("you'll receive $96.00 after the event wraps, once payouts release.");
  });
});
