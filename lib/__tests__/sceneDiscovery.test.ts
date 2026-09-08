jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../organizerProfile', () => ({ getOrganizerProfiles: jest.fn() }));
jest.mock('../communityLeader', () => ({ getLeaderCards: jest.fn() }));

const { applySceneFeedPolicy, eventKickerLabel } = require('../sceneDiscovery');

const row = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  event_date: null,
  start_time: null,
  end_time: null,
  ...fields,
});

describe('native Scene feed policy', () => {
  it('removes ended events immediately and orders end, start, LA date, then dateless', () => {
    const now = Date.parse('2026-08-16T12:00:00Z');
    const result = applySceneFeedPolicy([
      row('dateless'),
      row('expired', { end_time: '2026-08-16T05:59:59Z' }),
      row('date', { event_date: '2026-08-16' }),
      row('start', { start_time: '2026-08-16T13:00:00Z', event_date: '2026-08-20' }),
      row('ended', { end_time: '2026-08-16T11:00:00Z' }),
    ], now);
    expect(result.map((event: { id: string }) => event.id)).toEqual([
      'start', 'date', 'dateless',
    ]);
  });

  it('normalizes the shared card label grammar', () => {
    expect(eventKickerLabel({ community_id: 'community-1', category: 'Markets' })).toBe('community · markets');
    expect(eventKickerLabel({ community_id: 'community-1', category: 'Community' })).toBe('community');
    expect(eventKickerLabel({ community_id: null, category: 'Music' })).toBe('music');
  });
});
