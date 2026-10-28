import { plansOutsideFeatured } from '../feedPresentation';
import type { Plan } from '../fetchPlans';

const now = Date.parse('2026-10-28T06:00:00Z');
const own = { id: 'mine', creator: { id: 'viewer' }, start_time: '2026-11-07T23:00:00Z', is_featured: false } as Plan;
const featured = { ...own, id: 'picnic', is_featured: true, gender_rule: 'women_only' };

it('keeps the creator’s ordinary plan and featured plan when the carousel has no result', () => {
  expect(plansOutsideFeatured([own, featured], [], now)).toEqual([own, featured]);
});
it('deduplicates only cards actually rendered by the carousel', () => {
  expect(plansOutsideFeatured([own, featured], [featured], now)).toEqual([own]);
});
it('retains explicit end-time eligibility without resurrecting expired plans', () => {
  const ongoing = { ...own, start_time: '2026-10-28T01:00:00Z', end_time: '2026-10-28T07:00:00Z' };
  const expired = { ...ongoing, id: 'expired', end_time: '2026-10-28T05:00:00Z' };
  expect(plansOutsideFeatured([ongoing, expired], [], now)).toEqual([ongoing]);
});
