import { getPlanChatExpiry, getPlanChatTiming } from '../planChatExpiry';

describe('Plan chat expiry', () => {
  it('keeps a multi-day Plan chat through 48 hours after its end', () => {
    expect(getPlanChatExpiry('2026-09-19T18:00:00Z', '2026-09-21T20:00:00Z')?.toISOString())
      .toBe('2026-09-23T20:00:00.000Z');
  });

  it('retains start-plus-48 hours when no valid end exists', () => {
    expect(getPlanChatExpiry('2026-09-19T18:00:00Z', null)?.toISOString())
      .toBe('2026-09-21T18:00:00.000Z');
    expect(getPlanChatExpiry('2026-09-19T18:00:00Z', '2026-09-19T17:00:00Z')?.toISOString())
      .toBe('2026-09-21T18:00:00.000Z');
  });

  it('does not invent an expiry for an invalid start', () => {
    expect(getPlanChatExpiry('invalid')).toBeNull();
  });

  it('keeps the inbox active after start-plus-48 while a multi-day plan is ongoing', () => {
    const timing = getPlanChatTiming('2026-09-19T18:00:00Z', '2026-09-21T20:00:00Z', 'forming', Date.parse('2026-09-21T19:00:00Z'));
    expect(timing.isPast).toBe(false);
    expect(timing.remainingHours).toBe(49);
  });

  it('closes exactly at end-plus-48 and keeps a last partial hour visible before it', () => {
    const start='2026-09-19T18:00:00Z', end='2026-09-19T20:00:00Z';
    expect(getPlanChatTiming(start,end,'forming',Date.parse('2026-09-21T19:59:59Z'))).toMatchObject({isPast:false,remainingHours:1});
    expect(getPlanChatTiming(start,end,'forming',Date.parse('2026-09-21T20:00:00Z'))).toMatchObject({isPast:true,remainingHours:null});
  });

  it('keeps cancellation authoritative and omits countdowns before a plan starts', () => {
    const start='2026-09-19T18:00:00Z', end='2026-09-21T20:00:00Z';
    expect(getPlanChatTiming(start,end,'cancelled',Date.parse('2026-09-20T18:00:00Z'))).toMatchObject({isPast:true,remainingHours:null});
    expect(getPlanChatTiming(start,end,'forming',Date.parse('2026-09-18T18:00:00Z'))).toMatchObject({isPast:false,remainingHours:null});
  });
});
