jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../blocking', () => ({ getBlockedWith: jest.fn() }));

const { computeEventRoomExpiry, isInSaveNoticeWindow } = require('../communityChat');

function eventMeta(overrides: Record<string, unknown> = {}) {
  return {
    archived: false,
    explore_events: {
      status: 'published',
      host_user_id: 'creator-1',
      event_date: '2026-08-24',
      start_time: '2026-08-24T18:00:00.000Z',
      end_time: '2026-08-24T21:00:00.000Z',
      venue: 'Test venue',
      ...overrides,
    },
  };
}

describe('computeEventRoomExpiry', () => {
  it('closes 48 hours after the event end time', () => {
    expect(computeEventRoomExpiry(eventMeta())).toEqual(new Date('2026-08-26T21:00:00.000Z'));
  });

  it('falls back to start time when end time is absent', () => {
    expect(computeEventRoomExpiry(eventMeta({ end_time: null }))).toEqual(
      new Date('2026-08-26T18:00:00.000Z'),
    );
  });

  it('falls back to the event date when both timestamps are absent', () => {
    expect(computeEventRoomExpiry(eventMeta({ end_time: null, start_time: null }))?.getTime()).toBe(
      new Date('2026-08-24T00:00:00').getTime() + 48 * 60 * 60 * 1000,
    );
  });

  it('returns null for persistent rooms and invalid timestamps', () => {
    expect(computeEventRoomExpiry({ explore_events: null })).toBeNull();
    expect(computeEventRoomExpiry(eventMeta({ end_time: 'not-a-date' }))).toBeNull();
  });
});

describe('isInSaveNoticeWindow', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts exactly 24 hours before expiry and ends at expiry', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-25T21:00:00.000Z').getTime());
    expect(isInSaveNoticeWindow(eventMeta())).toBe(true);

    nowSpy.mockReturnValue(new Date('2026-08-26T21:00:00.000Z').getTime());
    expect(isInSaveNoticeWindow(eventMeta())).toBe(false);
  });

  it('stays off before the notice window and after the room is archived', () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-25T20:59:59.999Z').getTime());
    expect(isInSaveNoticeWindow(eventMeta())).toBe(false);
    expect(isInSaveNoticeWindow({ ...eventMeta(), archived: true })).toBe(false);
  });
});
