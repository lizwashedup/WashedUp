import { QueryClient } from '@tanstack/react-query';
import { buildOptimisticPlan, prependOptimisticPlan } from '../optimisticPlans';

const row = { title: 'Coffee in Venice', start_time: '2040-11-01T18:00:00Z', end_time: '2040-11-01T20:00:00Z', gender_rule: 'women_only', target_age_min: 25, target_age_max: 40 };
const createPlan = () => buildOptimisticPlan(row, 'creator', { id: 'creator', first_name_display: 'Liz', profile_photo_url: null });
let client: QueryClient;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); });
afterEach(() => client.clear());

it('shows the new own plan in the actual main feed and Yours, then swaps in the saved id', () => {
  const plan = createPlan();
  const existing = { ...plan, id: 'existing' };
  client.setQueryData(['events', 'feed', 'creator', 'all'], [existing]);
  const handle = prependOptimisticPlan(client, 'creator', plan);
  expect(client.getQueryData(['events', 'feed', 'creator', 'all'])).toEqual([plan, existing]);
  expect(client.getQueryData(['my-plans', 'creator'])).toEqual([plan]);
  expect(client.getQueryData(['events', 'feed', 'creator'])).toEqual([plan]);
  handle.commit('saved-plan');
  expect(client.getQueryData(['events', 'feed', 'creator', 'all'])).toEqual([{ ...plan, id: 'saved-plan' }, existing]);
  expect(client.getQueryData(['my-plans', 'creator'])).toEqual([{ ...plan, id: 'saved-plan' }]);
});

it('removes a failed post from both existing and previously absent caches', () => {
  const plan = createPlan();
  const existing = { ...plan, id: 'existing' };
  client.setQueryData(['events', 'feed', 'creator', 'all'], [existing]);
  const handle = prependOptimisticPlan(client, 'creator', plan);
  handle.rollback();
  expect(client.getQueryData(['events', 'feed', 'creator', 'all'])).toEqual([existing]);
  expect(client.getQueryData(['events', 'feed', 'creator'])).toEqual([]);
  expect(client.getQueryData(['my-plans', 'creator'])).toEqual([]);
  expect(client.getQueryState(['events', 'feed', 'creator'])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['my-plans', 'creator'])?.isInvalidated).toBe(true);
});

it('does not insert a plan into a Near me radius or another account', () => {
  const nearKey = ['events', 'feed', 'creator', 'near:34.000,-118.000,5'];
  const otherKey = ['events', 'feed', 'other-person', 'all'];
  const near = [{ ...createPlan(), id: 'nearby' }];
  const other = [{ ...createPlan(), id: 'other-account' }];
  client.setQueryData(nearKey, near);
  client.setQueryData(otherKey, other);
  const handle = prependOptimisticPlan(client, 'creator', createPlan());
  handle.commit('saved');
  expect(client.getQueryData(nearKey)).toEqual(near);
  expect(client.getQueryData(otherKey)).toEqual(other);
});

it('preserves the participation requirements and end time on the immediate own-plan card', () => {
  expect(createPlan()).toMatchObject({ gender_rule: 'women_only', target_age_min: 25, target_age_max: 40, end_time: row.end_time, creator: { id: 'creator' } });
});
