import { resolveCalendarInterval } from '../calendarInterval';

describe('calendar interval', () => {
  it('uses the saved end time when one exists', () => {
    const result = resolveCalendarInterval('2026-09-19T18:30:00-07:00', '2026-09-19T23:00:00-07:00');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.end.toISOString()).toBe('2026-09-20T06:00:00.000Z');
      expect(result.inferredEnd).toBe(false);
    }
  });

  it('uses the existing two-hour fallback only when no end was supplied', () => {
    const result = resolveCalendarInterval('2026-09-19T18:30:00-07:00', null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.end.getTime() - result.start.getTime()).toBe(2 * 60 * 60 * 1000);
      expect(result.inferredEnd).toBe(true);
    }
  });

  it('rejects invalid and reversed dates instead of making a broken entry', () => {
    expect(resolveCalendarInterval('not a date').ok).toBe(false);
    expect(resolveCalendarInterval('2026-09-19T18:30:00-07:00', 'invalid').ok).toBe(false);
    expect(resolveCalendarInterval('2026-09-19T18:30:00-07:00', '2026-09-19T18:00:00-07:00').ok).toBe(false);
  });
});
