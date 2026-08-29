const mockGetUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('../supabase', () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

// plain require, not a static import: ES imports get hoisted above these
// const declarations, so the mock factory above would see mockGetUser/
// mockFrom as undefined (see lib/__tests__/followerBroadcasts.test.ts for
// the same convention).
const { getCreatorAccess } = require('../creatorMode');

// Regression coverage for the 2026-08-29 loop bug: community_members.role is
// a live Postgres enum with only 'leader' | 'co_leader' | 'member' ever
// applied. The old .in('role', [...6 labels]) allowlist named four labels
// ('admin', 'events', 'member_care', 'finance') that were never added to the
// live enum, so Postgres threw 22P02 on every call. getCreatorAccess awaited
// only { data }, silently dropping that error, so an active leader always
// came back as ledCommunities = [] -- exactly the "start your community"
// entry screen looping forever, no matter how many times the RPC actually
// (correctly) seated the leader membership. The fix reads every non-member
// role instead of naming labels, so it can never again drift out of sync
// with the live enum.

function queryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.neq = jest.fn(self);
  chain.in = jest.fn(self);
  chain.order = jest.fn(self);
  chain.then = (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'liz-user-1' } } });
});

describe('getCreatorAccess', () => {
  it('reaches an active leader membership row (would 22P02 with the old enum allowlist)', async () => {
    const memberships = queryChain({
      data: [
        {
          role: 'leader',
          joined_at: '2026-08-29T00:00:00.000Z',
          communities: { id: 'community-1', handle: 'liz-community', name: "Liz's Community", status: 'active' },
        },
      ],
      error: null,
    });
    const grants = queryChain({ data: [{ track: 'community_leader', status: 'approved' }], error: null });
    mockFrom.mockImplementation((table: string) => (table === 'community_members' ? memberships : grants));

    const access = await getCreatorAccess();

    expect(access.ledCommunities).toEqual([
      { id: 'community-1', handle: 'liz-community', name: "Liz's Community", role: 'leader', status: 'active' },
    ]);
    // pins the fix: the query must ask Postgres to exclude 'member' by
    // negation, never by naming the other role labels individually --
    // naming them is exactly what silently broke this against the live enum.
    expect(memberships.neq).toHaveBeenCalledWith('role', 'member');
    expect(memberships.in).not.toHaveBeenCalled();
  });
});
