import { fetchFeaturedPlans } from '../fetchFeaturedPlans';
const mockRpc = jest.fn();
const mockRead = jest.fn();
jest.mock('../supabase', () => ({ supabase: {
  rpc: (...args: any[]) => mockRpc(...args),
  from: (table: string) => {
    const query: any = { select: () => query, in: () => query, eq: () => query, order: () => query,
      then: (resolve: any, reject: any) => Promise.resolve(mockRead(table)).then(resolve, reject) };
    return query;
  },
} }));
jest.mock('../fetchPlans', () => ({ fetchRealMemberCounts: jest.fn().mockResolvedValue({ picnic: 2 }) }));
beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: ['picnic'], error: null });
  mockRead.mockReset().mockImplementation(table => ({ data: table === 'events' ? [{
    id: 'picnic', title: 'Sunset picnic', creator_user_id: 'viewer', gender_rule: 'women_only',
    start_time: '2099-11-07T23:00:00Z', status: 'forming', is_featured: true,
  }] : [], error: null }));
});
it('keeps an eligible own featured plan with its audience badge', async () => {
  expect(await fetchFeaturedPlans('viewer')).toEqual([expect.objectContaining({
    id: 'picnic', gender_rule: 'women_only', creator: expect.objectContaining({ id: 'viewer' }),
  })]);
});
it('does not cache an eligibility error as an empty success', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
  await expect(fetchFeaturedPlans('viewer')).rejects.toThrow('offline');
  expect(mockRead).not.toHaveBeenCalled();
});
it('does not cache an event-read error as an empty success', async () => {
  mockRead.mockReturnValue({ data: null, error: { message: 'read failed' } });
  await expect(fetchFeaturedPlans('viewer')).rejects.toThrow('read failed');
});
it('does not read events when the eligibility RPC returns no IDs', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  expect(await fetchFeaturedPlans('viewer')).toEqual([]);
  expect(mockRead).not.toHaveBeenCalled();
});
