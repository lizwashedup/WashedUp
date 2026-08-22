const mockGetUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('../supabase', () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom, rpc: jest.fn() },
}));

const { getMyRsvp, setRsvp, getRsvpCount } = require('../eventRsvp');

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
});

describe('getMyRsvp', () => {
  it('returns null without querying when signed out', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(getMyRsvp('event-1')).resolves.toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns the row status when one exists', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { status: 'going' } }),
    };
    mockFrom.mockReturnValue(chain);

    await expect(getMyRsvp('event-1')).resolves.toBe('going');
    expect(mockFrom).toHaveBeenCalledWith('explore_event_rsvps');
    expect(chain.eq).toHaveBeenCalledWith('explore_event_id', 'event-1');
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('returns null when no row exists yet', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null }),
    };
    mockFrom.mockReturnValue(chain);
    await expect(getMyRsvp('event-1')).resolves.toBeNull();
  });
});

describe('setRsvp', () => {
  // Regression coverage for 2026-08-19: setRsvp briefly called a database
  // function (set_event_rsvp_atomic) that was never actually applied, which
  // broke every real RSVP toggle. This locks in the plain-upsert behavior it
  // was reverted to -- see the comment in eventRsvp.ts for the full story.
  it('throws when not signed in, without touching the database', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(setRsvp('event-1', true)).rejects.toThrow('Not signed in');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('upserts a going status by table upsert, not an rpc call', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert });

    await setRsvp('event-1', true);

    expect(mockFrom).toHaveBeenCalledWith('explore_event_rsvps');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ explore_event_id: 'event-1', user_id: 'user-1', status: 'going' }),
      { onConflict: 'explore_event_id,user_id' },
    );
  });

  it('upserts a cancelled status when going is false', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert });

    await setRsvp('event-1', false);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
      { onConflict: 'explore_event_id,user_id' },
    );
  });

  it('throws when the upsert fails', async () => {
    mockFrom.mockReturnValue({ upsert: jest.fn().mockResolvedValue({ error: new Error('boom') }) });
    await expect(setRsvp('event-1', true)).rejects.toThrow('boom');
  });
});

describe('getRsvpCount', () => {
  it('returns null on rpc error instead of throwing', async () => {
    const { supabase } = require('../supabase');
    supabase.rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(getRsvpCount('event-1')).resolves.toBeNull();
  });

  it('returns the numeric count on success', async () => {
    const { supabase } = require('../supabase');
    supabase.rpc.mockResolvedValue({ data: 5, error: null });
    await expect(getRsvpCount('event-1')).resolves.toBe(5);
  });
});
