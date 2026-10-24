const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: {
  from: (...args: unknown[]) => mockFrom(...args),
  rpc: (...args: unknown[]) => mockRpc(...args),
} }));
import { fetchMembers, fetchPlanDetail } from '../planDetailData';

function query(data: unknown, error: unknown = null) {
  const q = {
    select: jest.fn(), eq: jest.fn(),
    single: jest.fn().mockResolvedValue({ data, error }),
    maybeSingle: jest.fn().mockResolvedValue({ data, error }),
  };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q);
  return q;
}
const event = {
  id: 'plan-1', title: 'Coffee walk', start_time: '2040-11-04T09:37:17.123Z',
  end_time: '2040-11-04T11:37:17.123Z', status: 'forming', creator_user_id: 'creator-1',
};
beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });

it('reads the creator only through the public profile projection', async () => {
  const planQuery = query(event);
  const profileQuery = query({ id: 'creator-1', first_name_display: 'Amelia', handle: 'not-public' });
  mockFrom.mockReturnValueOnce(planQuery).mockReturnValueOnce(profileQuery);
  const plan = await fetchPlanDetail('plan-1');
  expect(mockFrom.mock.calls).toEqual([['events'], ['profiles_public']]);
  expect(planQuery.eq).toHaveBeenCalledWith('id', 'plan-1');
  expect(profileQuery.eq).toHaveBeenCalledWith('id', 'creator-1');
  expect(profileQuery.select).toHaveBeenCalledWith('id, first_name_display, profile_photo_url, bio');
  expect(plan.creator).toEqual({ id: 'creator-1', first_name_display: 'Amelia', profile_photo_url: null, bio: null });
  expect(plan).toMatchObject({ start_time: event.start_time, end_time: event.end_time, drop_in: true,
    allow_duplicate: true, is_featured: false, member_count: 0, target_age_min: null, target_age_max: null });
});

it('preserves explicit false, zero, custom bounds and Featured values', async () => {
  mockFrom.mockReturnValueOnce(query({ ...event, creator_user_id: null, drop_in: false, allow_duplicate: false,
    member_count: 0, max_invites: 0, location_lat: 0, location_lng: 0,
    target_age_min: 25, target_age_max: 35, is_featured: true, featured_type: 'special_event' }));
  const plan = await fetchPlanDetail('plan-1');
  expect(plan).toMatchObject({ creator: null, drop_in: false, allow_duplicate: false, member_count: 0,
    max_invites: 0, location_lat: 0, location_lng: 0, target_age_min: 25, target_age_max: 35,
    is_featured: true, featured_type: 'special_event' });
  expect(mockFrom).toHaveBeenCalledTimes(1);
});

it('propagates a plan read error without attempting profile enrichment', async () => {
  const error = { code: '42501', message: 'Unavailable' };
  mockFrom.mockReturnValue(query(null, error));
  await expect(fetchPlanDetail('plan-1')).rejects.toBe(error);
  expect(mockFrom.mock.calls).toEqual([['events']]);
});

it('retains the plan when optional public creator data is unavailable', async () => {
  mockFrom.mockReturnValueOnce(query(event)).mockReturnValueOnce(query(null, { code: 'unavailable' }));
  await expect(fetchPlanDetail('plan-1')).resolves.toMatchObject({ id: 'plan-1', creator: null });
});

it('uses revealed attendee names and avatars without a second public request', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ id: 'member-1', user_id: 'user-1', first_name: 'Amelia',
    first_name_display: 'Fallback', avatar_url: 'revealed.jpg', profile_photo_url: 'fallback.jpg',
    joined_at: '2040-01-01', handle: 'existing-handle' }], error: null });
  await expect(fetchMembers('plan-1')).resolves.toEqual([{ id: 'member-1', user_id: 'user-1',
    first_name_display: 'Amelia', profile_photo_url: 'revealed.jpg', joined_at: '2040-01-01', handle: 'existing-handle' }]);
  expect(mockRpc.mock.calls).toEqual([['get_event_members_reveal', { p_event_id: 'plan-1' }]]);
  expect(mockFrom).not.toHaveBeenCalled();
});

it('accepts an empty successful reveal without falling back to public attendees', async () => {
  mockRpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(fetchMembers('plan-1')).resolves.toEqual([]);
  expect(mockRpc).toHaveBeenCalledTimes(1);
});

it.each([
  { data: null, error: { code: '42501' } },
  { data: null, error: null },
  { data: { unexpected: true }, error: null },
])('uses the public attendee fallback when reveal is unavailable: %j', async response => {
  mockRpc.mockResolvedValueOnce(response).mockResolvedValueOnce({ data: [{ id: 'member-1', user_id: 'user-1', first_name_display: 'Amelia' }], error: null });
  await expect(fetchMembers('plan-1')).resolves.toEqual([{ id: 'member-1', user_id: 'user-1', first_name_display: 'Amelia', profile_photo_url: null, joined_at: '', handle: null }]);
  expect(mockRpc.mock.calls).toEqual([
    ['get_event_members_reveal', { p_event_id: 'plan-1' }],
    ['get_event_members_public', { p_event_id: 'plan-1' }],
  ]);
  expect(mockFrom).not.toHaveBeenCalled();
});

it('propagates fallback failure instead of returning an empty attendee list', async () => {
  const error = { code: 'unavailable' };
  mockRpc.mockResolvedValueOnce({ data: null, error }).mockResolvedValueOnce({ data: null, error });
  await expect(fetchMembers('plan-1')).rejects.toBe(error);
});

it.each([{ data: null }, { data: [] }])('maps a successful empty public response to no attendees: %j', async ({ data }) => {
  mockRpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data, error: null });
  await expect(fetchMembers('plan-1')).resolves.toEqual([]);
});
