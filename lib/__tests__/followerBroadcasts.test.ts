const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../supabase', () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom, rpc: mockRpc },
}));

/** Chainable .insert(...).select('id').single() mock, real shape as of the
    C-15 push-fanout change (native always sends immediately). */
function insertChain(result: { data: { id: string } | null; error: Error | null }) {
  const single = jest.fn().mockResolvedValue(result);
  const select = jest.fn(() => ({ single }));
  const insert = jest.fn(() => ({ select }));
  return { insert, select, single };
}

const { sendFollowerBroadcast, getMyFollowerBroadcastHistory } = require('../followerBroadcasts');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'broadcast-1',
    sender_user_id: 'user-1',
    community_id: null,
    organizer_user_id: 'user-1',
    body: 'hello followers',
    visible_at: '2026-08-19T00:00:00.000Z',
    created_at: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockRpc.mockResolvedValue({ data: 1, error: null });
});

describe('sendFollowerBroadcast', () => {
  it('throws when not signed in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(sendFollowerBroadcast({ kind: 'organizer' }, 'hi')).rejects.toThrow('Not signed in');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws on an empty message', async () => {
    await expect(sendFollowerBroadcast({ kind: 'organizer' }, '   ')).rejects.toThrow('Message is empty');
  });

  it('throws on a message over 2000 characters', async () => {
    await expect(sendFollowerBroadcast({ kind: 'organizer' }, 'x'.repeat(2001))).rejects.toThrow(
      'Message is too long',
    );
  });

  it('sends to followers of the sender as organizer, with no community_id', async () => {
    const chain = insertChain({ data: { id: 'broadcast-1' }, error: null });
    mockFrom.mockReturnValue({ insert: chain.insert });

    await sendFollowerBroadcast({ kind: 'organizer' }, '  hey everyone  ');

    expect(mockFrom).toHaveBeenCalledWith('follower_broadcasts');
    expect(chain.insert).toHaveBeenCalledWith({
      sender_user_id: 'user-1',
      organizer_user_id: 'user-1',
      community_id: null,
      body: 'hey everyone',
    });
  });

  it('sends to a community, with no organizer_user_id', async () => {
    const chain = insertChain({ data: { id: 'broadcast-9' }, error: null });
    mockFrom.mockReturnValue({ insert: chain.insert });

    await sendFollowerBroadcast({ kind: 'community', communityId: 'community-9' }, 'movie night');

    expect(chain.insert).toHaveBeenCalledWith({
      sender_user_id: 'user-1',
      organizer_user_id: null,
      community_id: 'community-9',
      body: 'movie night',
    });
  });

  it('throws when the insert fails', async () => {
    const chain = insertChain({ data: null, error: new Error('boom') });
    mockFrom.mockReturnValue({ insert: chain.insert });
    await expect(sendFollowerBroadcast({ kind: 'organizer' }, 'hi')).rejects.toThrow('boom');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('C-15: fans out real push through the existing OneSignal RPC after an immediate send', async () => {
    const chain = insertChain({ data: { id: 'broadcast-42' }, error: null });
    mockFrom.mockReturnValue({ insert: chain.insert });

    await sendFollowerBroadcast({ kind: 'organizer' }, 'live now');

    expect(mockRpc).toHaveBeenCalledWith('fanout_follower_broadcast_push', { p_broadcast_id: 'broadcast-42' });
  });

  it('C-15: a failing push fanout never surfaces as a failed send (best-effort)', async () => {
    const chain = insertChain({ data: { id: 'broadcast-7' }, error: null });
    mockFrom.mockReturnValue({ insert: chain.insert });
    mockRpc.mockRejectedValue(new Error('function fanout_follower_broadcast_push does not exist'));

    await expect(sendFollowerBroadcast({ kind: 'organizer' }, 'still sends')).resolves.toBeUndefined();
  });
});

describe('getMyFollowerBroadcastHistory', () => {
  it('returns an empty list when not signed in, without throwing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(getMyFollowerBroadcastHistory({ kind: 'organizer' })).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('scopes to the organizer target and maps rows to camelCase', async () => {
    const calls: unknown[] = [];
    const chain: any = {
      select: jest.fn((v) => { calls.push(['select', v]); return chain; }),
      eq: jest.fn((...args) => { calls.push(['eq', ...args]); return chain; }),
      order: jest.fn((...args) => {
        calls.push(['order', ...args]);
        return Promise.resolve({ data: [row()], error: null });
      }),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getMyFollowerBroadcastHistory({ kind: 'organizer' });

    expect(calls).toContainEqual(['eq', 'sender_user_id', 'user-1']);
    expect(calls).toContainEqual(['eq', 'organizer_user_id', 'user-1']);
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(result).toEqual([{
      id: 'broadcast-1',
      senderUserId: 'user-1',
      communityId: null,
      organizerUserId: 'user-1',
      body: 'hello followers',
      visibleAt: '2026-08-19T00:00:00.000Z',
      createdAt: '2026-08-19T00:00:00.000Z',
    }]);
  });

  it('scopes to the community target, not the sender-as-organizer', async () => {
    const calls: unknown[] = [];
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn((...args) => { calls.push(['eq', ...args]); return chain; }),
      order: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    mockFrom.mockReturnValue(chain);

    await getMyFollowerBroadcastHistory({ kind: 'community', communityId: 'community-9' });

    expect(calls).toContainEqual(['eq', 'community_id', 'community-9']);
    expect(calls).not.toContainEqual(['eq', 'organizer_user_id', 'user-1']);
  });

  it('throws when the query errors', async () => {
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => Promise.resolve({ data: null, error: new Error('boom') })),
    };
    mockFrom.mockReturnValue(chain);
    await expect(getMyFollowerBroadcastHistory({ kind: 'organizer' })).rejects.toThrow('boom');
  });
});
