const mockGetUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('../supabase', () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));
const { getBroadcastAudienceCount } = require('../creatorMode');

function audienceResult(count: number | null, error: Error | null = null) {
  const chain: any = {};
  for (const method of ['select', 'eq', 'neq']) chain[method] = jest.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ count, error }).then(resolve);
  mockFrom.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'creator' } }, error: null });
});

it.each([0, 24])('returns a confirmed %s recipients with the existing notification filters', async count => {
  const query = audienceResult(count);
  await expect(getBroadcastAudienceCount('sunset')).resolves.toBe(count);
  expect(mockFrom).toHaveBeenCalledWith('community_members');
  expect(query.eq.mock.calls).toEqual([
    ['community_id', 'sunset'], ['status', 'active'], ['broadcasts_muted', false],
  ]);
  expect(query.neq).toHaveBeenCalledWith('user_id', 'creator');
});

it('surfaces a failed read instead of reporting no recipients', async () => {
  audienceResult(null, new Error('Connection interrupted'));
  await expect(getBroadcastAudienceCount('sunset')).rejects.toThrow('Connection interrupted');
});

it('keeps an absent count distinct from a confirmed zero', async () => {
  audienceResult(null);
  await expect(getBroadcastAudienceCount('sunset')).rejects.toThrow('Could not check');
});

it('does not count recipients if the signed-in account cannot be checked', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('Account unavailable') });
  await expect(getBroadcastAudienceCount('sunset')).rejects.toThrow('Account unavailable');
  expect(mockFrom).not.toHaveBeenCalled();
});

it('does not include the sender because of a missing session', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(getBroadcastAudienceCount('sunset')).rejects.toThrow('Sign in');
  expect(mockFrom).not.toHaveBeenCalled();
});
