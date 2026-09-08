import { isPlanPast } from '../planTime';

describe('isPlanPast', () => {
  const now = '2026-09-08T20:00:00.000Z';

  it('keeps a plan joinable until its explicit end time', () => {
    expect(isPlanPast('2026-09-08T19:00:00.000Z', '2026-09-08T21:00:00.000Z', now)).toBe(false);
  });

  it('closes a plan at its explicit end time', () => {
    expect(isPlanPast('2026-09-08T18:00:00.000Z', '2026-09-08T20:00:00.000Z', now)).toBe(true);
  });

  it('uses a three-hour window when no end time was provided', () => {
    expect(isPlanPast('2026-09-08T17:00:01.000Z', null, now)).toBe(false);
    expect(isPlanPast('2026-09-08T17:00:00.000Z', null, now)).toBe(true);
  });
});
