type QueryCall = { table: string; method: string; args: unknown[] };

const mockCalls: QueryCall[] = [];
const mockRows: Record<string, unknown> = {};

function query(table: string) {
  const row = () => mockRows[table] ?? { data: null, error: null };
  const chain: any = {
    select: (...args: unknown[]) => {
      mockCalls.push({ table, method: 'select', args });
      return chain;
    },
    eq: (...args: unknown[]) => {
      mockCalls.push({ table, method: 'eq', args });
      return chain;
    },
    in: (...args: unknown[]) => {
      mockCalls.push({ table, method: 'in', args });
      return chain;
    },
    order: (...args: unknown[]) => {
      mockCalls.push({ table, method: 'order', args });
      return chain;
    },
    limit: (...args: unknown[]) => {
      mockCalls.push({ table, method: 'limit', args });
      return chain;
    },
    maybeSingle: () => Promise.resolve(row()),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(row()).then(resolve, reject),
  };
  return chain;
}

const mockSupabase = {
  from: jest.fn((table: string) => query(table)),
  rpc: jest.fn((name: string, args: unknown) => {
    mockCalls.push({ table: 'rpc', method: name, args: [args] });
    return Promise.resolve({ data: name === 'get_community_member_count' ? 12 : null, error: null });
  }),
  auth: { getUser: jest.fn() },
};

jest.mock('../supabase', () => ({
  supabase: mockSupabase,
}));

const { getCommunityPage, getMyCommunities } = require('../communityPage');

function calls(table: string, method: string) {
  return mockCalls.filter((call) => call.table === table && call.method === method);
}

beforeEach(() => {
  mockCalls.length = 0;
  mockSupabase.from.mockClear();
  mockSupabase.rpc.mockClear();
  mockSupabase.auth.getUser.mockReset();
  for (const key of Object.keys(mockRows)) delete mockRows[key];
});

describe('native community page data contract', () => {
  it('scopes every page query to the requested community and exposes only visible, live, capped rows', async () => {
    mockRows.communities = {
      data: { id: 'community-requested', handle: 'sunset', name: 'Sunset', description: null, accent_color: null, status: 'active' },
      error: null,
    };
    mockRows.community_blocks = { data: [{ id: 'visible', visible: true }], error: null };
    mockRows.explore_events = { data: [{ id: 'event-1', title: 'Soon' }], error: null };

    const result = await getCommunityPage('community-requested');

    expect(result).toMatchObject({ community: { id: 'community-requested' }, memberCount: 12 });
    expect(calls('communities', 'eq')).toContainEqual({ table: 'communities', method: 'eq', args: ['id', 'community-requested'] });
    expect(calls('community_blocks', 'eq')).toEqual(
      expect.arrayContaining([
        { table: 'community_blocks', method: 'eq', args: ['community_id', 'community-requested'] },
        { table: 'community_blocks', method: 'eq', args: ['visible', true] },
      ]),
    );
    expect(calls('community_blocks', 'order')).toContainEqual({ table: 'community_blocks', method: 'order', args: ['position', { ascending: true }] });
    expect(calls('explore_events', 'eq')).toEqual(
      expect.arrayContaining([
        { table: 'explore_events', method: 'eq', args: ['community_id', 'community-requested'] },
        { table: 'explore_events', method: 'eq', args: ['status', 'Live'] },
      ]),
    );
    expect(calls('explore_events', 'order')).toContainEqual({ table: 'explore_events', method: 'order', args: ['event_date', { ascending: true }] });
    expect(calls('explore_events', 'limit')).toContainEqual({ table: 'explore_events', method: 'limit', args: [6] });
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_community_member_count', { p_community_id: 'community-requested' });
  });

  it('projects active and archived memberships (never a draft), preserves each membership role, and reads visible covers for those communities only', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'viewer-1' } } });
    mockRows.community_members = {
      data: [
        { role: 'leader', communities: { id: 'c-lead', handle: 'lead', name: 'Lead', accent_color: null, status: 'active' } },
        { role: 'member', communities: { id: 'c-member', handle: 'member', name: 'Member', accent_color: null, status: 'active' } },
        // archived stays visible under Yours: existing members/leaders keep
        // access to what they already had, only new discovery closes.
        { role: 'co_leader', communities: { id: 'c-archived', handle: 'old', name: 'Old', accent_color: null, status: 'archived' } },
        // a never-published draft is the one status still filtered out here.
        { role: 'events', communities: { id: 'c-draft', handle: 'draft', name: 'Draft', accent_color: null, status: 'draft' } },
      ],
      error: null,
    };
    mockRows.community_blocks = {
      data: [
        { community_id: 'c-member', content: { images: ['member-cover'] }, position: 0 },
        { community_id: 'c-lead', content: { images: ['leader-cover'] }, position: 0 },
      ],
      error: null,
    };

    const result = await getMyCommunities();

    expect(result).toEqual([
      expect.objectContaining({ id: 'c-lead', role: 'leader', cover_image: 'leader-cover', member_count: 12 }),
      expect.objectContaining({ id: 'c-member', role: 'member', cover_image: 'member-cover', member_count: 12 }),
      expect.objectContaining({ id: 'c-archived', role: 'co_leader', cover_image: null, member_count: 12 }),
    ]);
    expect(calls('community_members', 'eq')).toEqual(
      expect.arrayContaining([
        { table: 'community_members', method: 'eq', args: ['user_id', 'viewer-1'] },
        { table: 'community_members', method: 'eq', args: ['status', 'active'] },
      ]),
    );
    expect(calls('community_blocks', 'in')).toContainEqual({ table: 'community_blocks', method: 'in', args: ['community_id', ['c-lead', 'c-member', 'c-archived']] });
    expect(calls('community_blocks', 'eq')).toEqual(
      expect.arrayContaining([
        { table: 'community_blocks', method: 'eq', args: ['block_type', 'cover'] },
        { table: 'community_blocks', method: 'eq', args: ['visible', true] },
      ]),
    );
  });
});
