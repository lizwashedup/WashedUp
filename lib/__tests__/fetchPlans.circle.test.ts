import { fetchPlans, fetchInterestedPlans } from '../fetchPlans';
import { toPlanCardPlan } from '../creatorMarks';
import { circlePlanCardState } from '../circlePlanCard';
const mockRpc = jest.fn(), mockSelect = jest.fn();
let mockGroups = true;
jest.mock('../../constants/FeatureFlags', () => ({ get GROUPS_ENABLED() { return mockGroups; } }));
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: any[]) => mockRpc(...args), from: (table: string) => ({ select: (fields: string) => ({ in: (key: string, ids: string[]) => mockSelect(table, fields, key, ids) }) }) } }));
const feed = { id: 'plan', title: 'A walk with friends', creator_user_id: 'person', creator_name: 'Amelia', member_count: 3, max_invites: 6, spots_remaining: 2 };
const metadata = { id: 'plan', circle_id: 'circle', circle_visibility: 'open', stranger_cap: 7 };
const ok = (data: any) => ({ data, error: null });
beforeEach(() => {
  mockGroups = true;
  mockRpc.mockReset().mockImplementation((name: string) => Promise.resolve(ok(name === 'get_filtered_feed' ? [feed] : [{ event_id: 'plan', joined_count: 12 }])));
  mockSelect.mockReset().mockImplementation((_table, fields) => Promise.resolve(ok(fields === 'creator_user_id' ? [] : [metadata])));
});
it('carries feed outsider places independently through enrichment and the shared card adapter', async () => {
  const [row] = await fetchPlans('viewer');
  expect(row).toMatchObject({ circle_metadata_known: true, circle_id: 'circle', spots_remaining: 2, member_count: 12 });
  expect(circlePlanCardState(toPlanCardPlan(row))).toMatchObject({ kind: 'open', remaining: 2, footer: '2 spots open' });
  expect(mockRpc).toHaveBeenCalledWith('get_filtered_feed', { p_user_id: 'viewer' });
});
it.each([null, -1, 1.5, '2', undefined])('does not invent outsider availability from total attendance when feed count is %p', async spots_remaining => {
  mockRpc.mockImplementation((name: string) => Promise.resolve(ok(name === 'get_filtered_feed' ? [{ ...feed, spots_remaining }] : [{ event_id: 'plan', joined_count: 12 }])));
  const [row] = await fetchPlans('viewer');
  expect(circlePlanCardState(toPlanCardPlan(row)).remaining).toBeNull();
});
it.each([{ data: [] }, { data: [{ id: 'plan' }] }, { data: [{ id: 'plan', circle_id: '' }] }])('keeps missing provenance unknown: %p', async ({ data }) => {
  mockSelect.mockResolvedValue(ok(data));
  const [row] = await fetchPlans('viewer');
  expect(row.circle_metadata_known).toBe(false);
  expect(circlePlanCardState(toPlanCardPlan(row)).kind).toBe('unknown');
});
it('keeps failed enrichment unknown without discarding the eligible feed row', async () => {
  mockSelect.mockImplementation((_table, fields) => Promise.resolve(fields === 'creator_user_id' ? ok([]) : { data: null, error: { message: 'offline' } }));
  const [row] = await fetchPlans('viewer');
  expect(row.id).toBe('plan');
  expect(circlePlanCardState(toPlanCardPlan(row))).toMatchObject({ kind: 'unknown', remaining: null });
});
it('recognizes explicit null as ordinary provenance', async () => {
  mockSelect.mockResolvedValue(ok([{ id: 'plan', circle_id: null }]));
  expect(circlePlanCardState(toPlanCardPlan((await fetchPlans('viewer'))[0])).kind).toBe('ordinary');
});
it('does not request held Circle columns when the feature is disabled', async () => {
  mockGroups = false;
  mockSelect.mockResolvedValue(ok([{ id: 'plan' }]));
  expect(circlePlanCardState(toPlanCardPlan((await fetchPlans('viewer'))[0])).kind).toBe('ordinary');
  expect(mockSelect.mock.calls.every(call => !call[1].includes('circle_id'))).toBe(true);
});

it('carries interested Circle plans through the same mapper without a fabricated availability value', async () => {
  mockRpc.mockImplementation((name: string) => Promise.resolve(ok(name === 'get_user_interest_signals' ? [{ event_id: 'plan' }] : [{ event_id: 'plan', joined_count: 12 }])));
  mockSelect.mockImplementation((table: string) => Promise.resolve(ok(table === 'events' ? [{ ...feed, ...metadata, spots_remaining: undefined }] : [{ id: 'person', first_name_display: 'Amelia' }])));
  const [row] = await fetchInterestedPlans();
  expect(row).toMatchObject({ circle_id: 'circle', circle_metadata_known: true, spots_remaining: null, member_count: 12, creator: { id: 'person', first_name_display: 'Amelia' } });
  expect(circlePlanCardState(toPlanCardPlan(row))).toMatchObject({ kind: 'open', remaining: null });
});

it.each(['signals','events','profiles'])('strict Interested reads reject %s failures while legacy callers retain their behavior', async step => {
 mockRpc.mockImplementation((name:string) => Promise.resolve(name==='get_user_interest_signals'
   ? step==='signals'?{data:null,error:new Error('offline')}:ok([{event_id:'plan'}])
   :ok([{event_id:'plan',joined_count:12}])));
 mockSelect.mockImplementation((table:string) => Promise.resolve((table==='events'&&step==='events')||(table==='profiles'&&step==='profiles')
   ?{data:null,error:new Error('offline')}:ok(table==='events'?[{...feed,...metadata}]:[])));
 await expect(fetchInterestedPlans({throwOnError:true})).rejects.toThrow('offline');
 await expect(fetchInterestedPlans()).resolves.toHaveLength(step==='profiles'?1:0);
});


it.each([[20,39],[21,99],[null,null]])('preserves loaded age bounds %s/%s and the creator note through feed/card adapters', async (min,max) => {
  mockRpc.mockImplementation((name: string) => Promise.resolve(ok(name === 'get_filtered_feed' ? [{...feed,host_message:'Come for a slow walk by the water.'}] : [])));
  mockSelect.mockImplementation((_table,fields) => Promise.resolve(ok(fields === 'creator_user_id' ? [] : [{...metadata,target_age_min:min,target_age_max:max}])));
  const card = toPlanCardPlan((await fetchPlans('viewer'))[0]);
  expect(card).toMatchObject({target_age_min:min,target_age_max:max,host_message:'Come for a slow walk by the water.'});
  expect(mockSelect.mock.calls.some(call => call[1].includes('target_age_min, target_age_max'))).toBe(true);
});
it.each([ok([]),ok([{id:'plan'}]),{data:null,error:{message:'offline'}}])('does not invent Any age when enrichment is absent: %j', async response => {
  mockSelect.mockImplementation((_table,fields) => Promise.resolve(fields === 'creator_user_id' ? ok([]) : response));
  const card = toPlanCardPlan((await fetchPlans('viewer'))[0]);
  expect(card.target_age_min).toBeUndefined();expect(card.target_age_max).toBeUndefined();
});
it('preserves explicit restricted ages in interested plans with the same creator message', async () => {
  mockRpc.mockImplementation((name: string) => Promise.resolve(ok(name === 'get_user_interest_signals' ? [{event_id:'plan'}] : [])));
  mockSelect.mockImplementation((table: string) => Promise.resolve(ok(table === 'events' ? [{...feed,...metadata,target_age_min:30,target_age_max:39,host_message:'Come for a slow walk by the water.'}] : [])));
  expect(toPlanCardPlan((await fetchInterestedPlans())[0])).toMatchObject({target_age_min:30,target_age_max:39,host_message:'Come for a slow walk by the water.'});
});

// Reproduces the live 42703: cluster_root_id is a feed RPC result, not an events column.
it('loads Interested from table columns while preserving feed-only duplicate grouping', async () => {
  mockRpc.mockImplementation((name: string) => Promise.resolve(ok(name === 'get_user_interest_signals'
    ? [{ event_id: 'plan' }] : name === 'get_filtered_feed' ? [{ ...feed, cluster_root_id: 'lineage' }] : [])));
  mockSelect.mockImplementation((table: string, fields: string) => Promise.resolve(
    table === 'events' && fields.split(',').map(field => field.trim()).includes('cluster_root_id')
      ? { data: null, error: { code: '42703', message: 'column events.cluster_root_id does not exist' } }
      : ok(table === 'events' ? [{ ...feed, ...metadata, allow_duplicate: false }] : [])));
  const [interested] = await fetchInterestedPlans({ throwOnError: true });
  expect(interested).toMatchObject({ id: 'plan', cluster_root_id: null, allow_duplicate: false, circle_id: 'circle' });
  const [discovery] = await fetchPlans('viewer');
  expect(discovery.cluster_root_id).toBe('lineage');
});
