const mockRead = jest.fn();
jest.mock('../supabase', () => ({ supabase: { from: (table: string) => {
  let columns = '', period = '';
  const query: any = {};
  query.select = (value: string) => { columns = value; return query; };
  query.gte = () => { period = 'upcoming'; return query; };
  query.lt = () => { period = 'past'; return query; };
  for (const key of ['eq', 'is', 'in', 'order', 'limit', 'maybeSingle']) query[key] = () => query;
  query.then = (resolve: any, reject: any) => Promise.resolve(mockRead(table, columns, period)).then(resolve, reject);
  return query;
} } }));
jest.mock('../uploadPhoto', () => ({ uploadBase64ToStorage: jest.fn() }));
import { getOrganizationPage } from '../organizerProfile';

const profile = { user_id: 'organizer', display_name: 'Local Walks', logo_url: null, bio: null, link_url: null };
beforeEach(() => mockRead.mockReset().mockImplementation((table, columns) => ({ data: table === 'explore_events' ? [] : columns === 'city' ? { city: 'Los Angeles' } : columns === 'support_email' ? null : profile, error: null })));

it('does not turn a network failure into a missing organization', async () => {
  const error = { message: 'Failed to fetch', code: '' };
  mockRead.mockResolvedValueOnce({ data: null, error });
  await expect(getOrganizationPage('organizer')).rejects.toEqual(error);
});
it.each(['upcoming', 'past'])('does not turn a failed %s event read into an empty list', async period => {
  const error = { message: 'Connection lost', code: '' };
  mockRead.mockImplementation((table, columns, selected) => ({ data: table === 'explore_events' ? [] : columns === 'city' || columns === 'support_email' ? null : profile, error: selected === period ? error : null }));
  await expect(getOrganizationPage('organizer')).rejects.toEqual(error);
});
it.each(['42P01', 'PGRST205', '42703', 'PGRST204'])('preserves dormant organization schema handling for %s', async code => {
  mockRead.mockResolvedValueOnce({ data: null, error: { code } });
  await expect(getOrganizationPage('organizer')).resolves.toBeNull();
});
it('keeps a confirmed missing profile separate from a failed read', async () => {
  mockRead.mockResolvedValueOnce({ data: null, error: null });
  await expect(getOrganizationPage('organizer')).resolves.toBeNull();
});
it('keeps optional city/support fields dormant when their columns are absent', async () => {
  mockRead.mockImplementation((table, columns) => columns === 'city' || columns === 'support_email' ? { data: null, error: { code: '42703' } } : { data: table === 'explore_events' ? [] : profile, error: null });
  await expect(getOrganizationPage('organizer')).resolves.toEqual({ profile: { ...profile, city: null, support_email: null }, upcomingEvents: [], pastEvents: [] });
});
