import { eventStartIso, getLAWallParts, isValidLAWallTime, laEventInstantIso, laWallTimeToUTC, resolveOvernightLAEnd, DEFAULT_EVENT_START_TIME } from '../laDate';

// eventStartIso/laEventInstantIso moved here from app/event/[id].tsx (private
// before) so app/tickets/order/[id].tsx (Scene handoff §06/07's ticketed-
// purchase calendar/nudge sequence) can reuse the same LA-pinned logic
// instead of a second, divergent copy.

describe('laEventInstantIso', () => {
  it('pins an LA wall time to the correct UTC instant (PDT, UTC-7)', () => {
    // 2026-07-04 19:00 LA time = 2026-07-05 02:00 UTC during PDT
    expect(laEventInstantIso('2026-07-04', '19:00')).toBe('2026-07-05T02:00:00.000Z');
  });

  it('pins correctly across the PST offset (UTC-8) too', () => {
    // 2026-01-15 19:00 LA time = 2026-01-16 03:00 UTC during PST
    expect(laEventInstantIso('2026-01-15', '19:00')).toBe('2026-01-16T03:00:00.000Z');
  });

  it('returns null when the date or time cannot be parsed', () => {
    expect(laEventInstantIso('not-a-date', '19:00')).toBeNull();
    expect(laEventInstantIso('2026-07-04', 'not-a-time')).toBeNull();
  });
});

describe('eventStartIso', () => {
  it('returns null with no date at all', () => {
    expect(eventStartIso(null, '19:00:00')).toBeNull();
  });

  it('passes an already-full ISO/space timestamp straight through', () => {
    expect(eventStartIso('2026-07-04', '2026-07-04T20:30:00.000Z')).toBe('2026-07-04T20:30:00.000Z');
    expect(eventStartIso('2026-07-04', '2026-07-04 20:30:00')).toBe('2026-07-04 20:30:00');
  });

  it('resolves a bare HH:MM wall time via the LA offset', () => {
    expect(eventStartIso('2026-07-04', '19:00')).toBe(laEventInstantIso('2026-07-04', '19:00'));
  });

  it('falls back to the house default start time when none is given', () => {
    expect(eventStartIso('2026-07-04', null)).toBe(laEventInstantIso('2026-07-04', DEFAULT_EVENT_START_TIME));
  });
});

describe('Plan edit time round trip', () => {
  it.each([
    ['2026-07-04T02:07:00.000Z', 2026, 6, 3, 19, 7],
    ['2026-01-16T03:43:00.000Z', 2026, 0, 15, 19, 43],
  ])('preserves LA wall date and exact minute for %s', (iso, year, month, day, hour, minute) => {
    const wall = getLAWallParts(iso);
    expect(wall).toEqual({ y: year, m: month, d: day, hour24: hour, minute });
    expect(laWallTimeToUTC(wall!.y, wall!.m, wall!.d, wall!.hour24, wall!.minute).toISOString()).toBe(iso);
  });
});

describe('LA scheduling validity', () => {
  it('rejects the spring-forward hour that does not exist', () => {
    expect(isValidLAWallTime(2026, 2, 8, 2, 30)).toBe(false);
    expect(isValidLAWallTime(2026, 2, 8, 3, 30)).toBe(true);
  });

  it('keeps real fall-back times available and rejects invalid dates', () => {
    expect(isValidLAWallTime(2026, 10, 1, 1, 30)).toBe(true);
    expect(isValidLAWallTime(2026, 1, 30, 12, 0)).toBe(false);
  });

  it('rolls an overnight Plan by LA calendar date across spring daylight saving', () => {
    expect(resolveOvernightLAEnd(2026, 2, 7, 23, 30, 3, 30)?.toISOString()).toBe('2026-03-08T10:30:00.000Z');
    expect(resolveOvernightLAEnd(2026, 2, 7, 23, 30, 2, 30)).toBeNull();
  });
});
