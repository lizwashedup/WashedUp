import { circlePlanCardState } from '../../lib/circlePlanCard';
const mockQuery = jest.fn(), mockRead = jest.fn();
let mockGroups = true;
jest.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => mockQuery(options) }));
jest.mock('../../constants/FeatureFlags', () => ({ COMMUNITIES_ENABLED: true, get GROUPS_ENABLED() { return mockGroups; } }));
jest.mock('../../lib/creatorMarks', () => ({ populateCreatorMarks: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/fetchPlans', () => ({ fetchInterestedPlans: jest.fn(), fetchRealMemberCounts: jest.fn().mockResolvedValue({ plan: 12 }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => {
  let fields = ''; const filters: Record<string, any> = {};
  const q: any = { select: (value: string) => { fields = value; return q; }, eq: (key: string, value: any) => { filters[key] = value; return q; }, in: (key: string, value: any) => { filters[key] = value; return q; }, order: () => q,
    then: (resolve: any, reject: any) => Promise.resolve(mockRead(table, fields, filters)).then(resolve, reject) }; return q;
} } }));
const { useMyPlans, useSavedPlans, useWaitlistedPlans } = require('../useMyPlansData') as typeof import('../useMyPlansData');
const event = { id: 'plan', title: 'Walk', creator_user_id: 'person', status: 'forming', end_time: '2040-01-01T20:00:00Z', member_count: 3, max_invites: 6, circle_id: 'circle', circle_visibility: 'open', stranger_cap: 6 };
beforeEach(() => {
  jest.useFakeTimers();
  mockGroups = true; mockQuery.mockReset().mockImplementation(options => options);
  mockRead.mockReset().mockImplementation((table, _fields, filters) => ({ error: null, data:
    table === 'events' ? [event] : table === 'profiles_public' ? [{ id: 'person', first_name_display: 'Amelia' }] :
    table === 'event_members' ? filters.status === 'left' ? [] : [{ event_id: 'plan', events: event }] : [{ event_id: 'plan' }],
  }));
});
it.each([useMyPlans, useSavedPlans, useWaitlistedPlans])('preserves Circle provenance and creator in %p without inventing outside places', async hook => {
  hook('viewer'); const rows = await mockQuery.mock.calls[0][0].queryFn();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ circle_metadata_known: true, circle_id: 'circle', stranger_cap: 6, spots_remaining: null, end_time: '2040-01-01T20:00:00Z', member_count: 12, creator: { id: 'person', first_name_display: 'Amelia' } });
  expect(circlePlanCardState(rows[0])).toMatchObject({ kind: 'open', remaining: null });
  const eventReads = mockRead.mock.calls.filter(([table, fields]) => table === 'events' || fields.includes('events ('));
  expect(eventReads.length).toBeGreaterThan(0);
  expect(eventReads.every(([, fields]) => fields.includes('circle_id') && fields.includes('stranger_cap') && fields.includes('end_time'))).toBe(true);
});
it('retains the explicit left-membership exclusion for personal plans', async () => {
  mockRead.mockImplementation((table, _fields, filters) => ({ data: table === 'events' ? [event] : table === 'event_members' ? filters.status === 'left' ? [{ event_id: 'plan' }] : [{ events: event }] : [], error: null }));
  useMyPlans('viewer'); expect(await mockQuery.mock.calls[0][0].queryFn()).toEqual([]);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
it.each(['useMyPlans', 'useSavedPlans', 'useWaitlistedPlans'])('keeps held Circle columns out when disabled for %s', async name => {
  mockGroups = false;
  jest.isolateModules(() => { require('../useMyPlansData')[name]('viewer'); });
  await mockQuery.mock.calls[0][0].queryFn();
  expect(mockRead.mock.calls.every(([, fields]) => !fields.includes('circle_id'))).toBe(true);
});

// Collection failures must remain errors so Yours can retain cached cards.
it.each([
 ['useMyPlans','event_members','joined'], ['useMyPlans','events',null], ['useMyPlans','event_members','left'],
 ['useSavedPlans','wishlists',null], ['useSavedPlans','events',null],
 ['useWaitlistedPlans','event_waitlist',null], ['useWaitlistedPlans','events',null],
 ['useMyPlanDrafts','events',null], ['useMyPlans','profiles_public',null],
 ['useSavedPlans','profiles_public',null], ['useWaitlistedPlans','profiles_public',null],
])('%s propagates failed %s/%s reads rather than successful emptiness', async (name, table, status) => {
 const normal = mockRead.getMockImplementation()!;
 mockRead.mockImplementation((t, fields, filters) => t===table && (status===null || filters.status===status)
  ? {data:null,error:new Error('offline')} : normal(t,fields,filters));
 require('../useMyPlansData')[name]('viewer');
 const options=mockQuery.mock.calls[0][0];
 await expect(options.queryFn()).rejects.toThrow('offline');
 expect(options.retry).toBe(false);
});
it.each(['useMyPlans','useMyPlanDrafts','useSavedPlans','useWaitlistedPlans'])('%s bounds a stalled read without publishing a late empty result', async name => {
 let finish!: (value:any) => void;
 mockRead.mockReturnValue(new Promise(resolve => {finish=resolve;}));
 require('../useMyPlansData')[name]('viewer');
 const request=mockQuery.mock.calls[0][0].queryFn();
 const outcome=expect(request).rejects.toThrow('took too long');
 await jest.advanceTimersByTimeAsync(name==='useSavedPlans'?8000:12000);
 await outcome; finish({data:[],error:null}); await Promise.resolve();
});
it('opts the Interested collection into strict read failures and a deadline', async () => {
 const reader=require('../../lib/fetchPlans').fetchInterestedPlans;
 reader.mockReturnValue(new Promise(() => {}));
 require('../useMyPlansData').useInterestedPlans('viewer');
 const request=mockQuery.mock.calls[0][0].queryFn();
 const outcome=expect(request).rejects.toThrow('took too long');
 await jest.advanceTimersByTimeAsync(12000);await outcome;
 expect(reader).toHaveBeenCalledWith({throwOnError:true});
});
