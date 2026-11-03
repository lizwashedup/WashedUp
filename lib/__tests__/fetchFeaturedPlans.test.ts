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
  mockRpc.mockReset().mockImplementation(name => ({ data: name === 'get_featured_eligible_ids' ? ['picnic'] : [], error: null }));
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

it('loads outsider-visible attendee photos through the public roster instead of the member-only table', async () => {
  mockRpc.mockImplementation(name => ({ data: name === 'get_featured_eligible_ids' ? ['picnic'] : [
    { profile_photo_url: 'https://example.test/member.jpg' }, { profile_photo_url: null },
  ], error: null }));
  const [plan] = await fetchFeaturedPlans('viewer');
  expect(mockRpc).toHaveBeenCalledWith('get_event_members_public', { p_event_id: 'picnic' });
  expect(mockRead).not.toHaveBeenCalledWith('event_members');
  expect(plan.attendees).toEqual([{profile_photo_url:'https://example.test/member.jpg'},{profile_photo_url:null}]);
  expect(plan.member_count).toBe(2);
});
it('does not turn a failed public roster read into an empty featured group', async () => {
  mockRpc.mockImplementation(name => name === 'get_featured_eligible_ids'
    ? {data:['picnic'],error:null} : {data:null,error:{message:'Roster unavailable'}});
  await expect(fetchFeaturedPlans('viewer')).rejects.toThrow('Roster unavailable');
});
