import { readFeedMemberIds } from '../feedMembership';
import { supabase } from '../supabase';
jest.mock('../supabase', () => ({ supabase: { from: jest.fn() } }));

function arrange(results: any[]) {
  const queries: any[] = [];
  (supabase.from as jest.Mock).mockImplementation(() => {
    const result = results[queries.length];
    const query: any = { select: jest.fn(() => query), eq: jest.fn(() => query), then: (resolve: any) => Promise.resolve(result).then(resolve) };
    queries.push(query); return query;
  });
  return queries;
}
afterEach(() => jest.clearAllMocks());
it('includes current attendees and creators once, excluding creators who left', async () => {
  const queries = arrange([
    { data: [{ event_id: 'joined' }, { event_id: 'both' }], error: null },
    { data: [{ id: 'created' }, { id: 'both' }, { id: 'departed' }], error: null },
    { data: [{ event_id: 'departed' }], error: null },
  ]);
  expect(await readFeedMemberIds('viewer')).toEqual(['joined', 'both', 'created']);
  expect(queries[0].eq.mock.calls).toEqual([['user_id', 'viewer'], ['status', 'joined']]);
  expect(queries[1].eq.mock.calls).toEqual([['creator_user_id', 'viewer']]);
  expect(queries[2].eq.mock.calls).toEqual([['user_id', 'viewer'], ['status', 'left']]);
});
it.each([0, 1, 2])('does not infer membership when read %s fails', async index => {
  const failure = new Error('offline');
  const results = [0, 1, 2].map(i => ({ data: i === 1 ? [{ id: 'created' }] : [], error: i === index ? failure : null }));
  arrange(results);
  await expect(readFeedMemberIds('viewer')).rejects.toBe(failure);
});
it('returns no participation for a confirmed empty account', async () => {
  arrange([0, 1, 2].map(() => ({ data: [], error: null })));
  expect(await readFeedMemberIds('viewer')).toEqual([]);
});
