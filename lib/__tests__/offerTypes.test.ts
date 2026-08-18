import {
  OFFER_TYPE_OPTIONS,
  COURSE_MIN_SESSIONS,
  COURSE_MAX_SESSIONS,
  courseDateRange,
  describeOfferType,
  isOfferType,
  isOfferTypeSellableToday,
  offerTypeRequiresSessions,
  sortSessions,
  validateCourseSessions,
} from '../offerTypes';

describe('the six offer types (CTO scope item 9 / C-18)', () => {
  it('lists exactly the six types named in the source docs, in their documented order', () => {
    expect(OFFER_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      'free_event',
      'ticketed_event',
      'course',
      'drop_in',
      'class_pack',
      'subscription',
    ]);
  });

  it('describeOfferType returns a real label for every value and falls back to the raw value otherwise', () => {
    for (const opt of OFFER_TYPE_OPTIONS) {
      expect(describeOfferType(opt.value)).toBe(opt.label);
    }
  });

  it('isOfferType is a real type guard, not a rubber stamp', () => {
    expect(isOfferType('course')).toBe(true);
    expect(isOfferType('workshop')).toBe(false);
    expect(isOfferType('')).toBe(false);
  });

  it('only course requires the sessions mechanic', () => {
    expect(offerTypeRequiresSessions('course')).toBe(true);
    for (const opt of OFFER_TYPE_OPTIONS.filter((o) => o.value !== 'course')) {
      expect(offerTypeRequiresSessions(opt.value)).toBe(false);
    }
  });

  it('class_pack and subscription are honestly marked not sellable today; everything else is', () => {
    expect(isOfferTypeSellableToday('free_event')).toBe(true);
    expect(isOfferTypeSellableToday('ticketed_event')).toBe(true);
    expect(isOfferTypeSellableToday('course')).toBe(true);
    expect(isOfferTypeSellableToday('drop_in')).toBe(true);
    expect(isOfferTypeSellableToday('class_pack')).toBe(false);
    expect(isOfferTypeSellableToday('subscription')).toBe(false);
  });
});

describe('validateCourseSessions ("the required series of dates ... as one offer")', () => {
  it('refuses a single date -- one date is an event, not a course', () => {
    const result = validateCourseSessions([{ start: '2026-09-01T18:00:00Z' }]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(new RegExp(`${COURSE_MIN_SESSIONS}`));
  });

  it('refuses zero dates', () => {
    expect(validateCourseSessions([]).ok).toBe(false);
  });

  it('accepts a real multi-week series (Farrah\'s four-week Mahjong course)', () => {
    const result = validateCourseSessions([
      { start: '2026-09-01T18:00:00Z', end: '2026-09-01T20:00:00Z' },
      { start: '2026-09-08T18:00:00Z', end: '2026-09-08T20:00:00Z' },
      { start: '2026-09-15T18:00:00Z', end: '2026-09-15T20:00:00Z' },
      { start: '2026-09-22T18:00:00Z', end: '2026-09-22T20:00:00Z' },
    ]);
    expect(result).toEqual({ ok: true, message: null });
  });

  it('sessions do not need an end time', () => {
    const result = validateCourseSessions([
      { start: '2026-09-01T18:00:00Z' },
      { start: '2026-09-08T18:00:00Z' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('refuses a session whose end is not after its start', () => {
    const same = validateCourseSessions([
      { start: '2026-09-01T18:00:00Z', end: '2026-09-01T18:00:00Z' },
      { start: '2026-09-08T18:00:00Z' },
    ]);
    expect(same.ok).toBe(false);

    const before = validateCourseSessions([
      { start: '2026-09-01T18:00:00Z', end: '2026-09-01T17:00:00Z' },
      { start: '2026-09-08T18:00:00Z' },
    ]);
    expect(before.ok).toBe(false);
  });

  it('refuses two sessions at the exact same start time', () => {
    const result = validateCourseSessions([
      { start: '2026-09-01T18:00:00Z' },
      { start: '2026-09-01T18:00:00Z' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/same start time/);
  });

  it('refuses an unparseable date rather than silently accepting garbage', () => {
    const result = validateCourseSessions([
      { start: 'not a date' },
      { start: '2026-09-08T18:00:00Z' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('refuses an unparseable end time', () => {
    const result = validateCourseSessions([
      { start: '2026-09-01T18:00:00Z', end: 'not a date' },
      { start: '2026-09-08T18:00:00Z' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('refuses past the max session ceiling', () => {
    const many = Array.from({ length: COURSE_MAX_SESSIONS + 1 }, (_, i) => ({
      start: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    }));
    expect(validateCourseSessions(many).ok).toBe(false);
  });

  it('accepts right at the max ceiling', () => {
    const many = Array.from({ length: COURSE_MAX_SESSIONS }, (_, i) => ({
      start: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    }));
    expect(validateCourseSessions(many).ok).toBe(true);
  });
});

describe('sortSessions and courseDateRange', () => {
  it('sorts out-of-order sessions ascending by start', () => {
    const sorted = sortSessions([
      { start: '2026-09-15T18:00:00Z' },
      { start: '2026-09-01T18:00:00Z' },
      { start: '2026-09-08T18:00:00Z' },
    ]);
    expect(sorted.map((s) => s.start)).toEqual([
      '2026-09-01T18:00:00Z',
      '2026-09-08T18:00:00Z',
      '2026-09-15T18:00:00Z',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [{ start: '2026-09-15T18:00:00Z' }, { start: '2026-09-01T18:00:00Z' }];
    const copy = [...input];
    sortSessions(input);
    expect(input).toEqual(copy);
  });

  it('courseDateRange returns the first and last session start, regardless of input order', () => {
    const range = courseDateRange([
      { start: '2026-09-15T18:00:00Z' },
      { start: '2026-09-01T18:00:00Z' },
      { start: '2026-09-08T18:00:00Z' },
    ]);
    expect(range).toEqual({ firstStart: '2026-09-01T18:00:00Z', lastStart: '2026-09-15T18:00:00Z' });
  });

  it('courseDateRange returns null for an empty set', () => {
    expect(courseDateRange([])).toBeNull();
  });
});
