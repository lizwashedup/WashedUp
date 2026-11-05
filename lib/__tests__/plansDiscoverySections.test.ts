import { filterIntoSections, getSectionDefs, groupIntoFeedItems } from '../plansDiscoverySections';
import type { Plan } from '../fetchPlans';
import type { CategoryOption } from '../../constants/Categories';

const plan = (id: string, start: Date, extra: Partial<Plan> = {}) => ({
  id, start_time: start.toISOString(), category: 'Outdoors', max_invites: 5,
  member_count: 1, creator: { id: `creator-${id}` }, ...extra,
} as Plan);
const ids = (plans: ReturnType<typeof groupIntoFeedItems>) => plans.map(item =>
  item.kind === 'standalone' ? item.plan.id : item.plans.map(p => p.id));

it('preserves visible cluster membership, space priority and one card per known creator', () => {
  const date = new Date(2026, 10, 6, 18);
  const input = [
    plan('full', date, { cluster_root_id: 'root', member_count: 6 }),
    plan('open', date, { cluster_root_id: 'root', member_count: 1 }),
    plan('duplicate-creator', date, { cluster_root_id: 'root', member_count: 4, creator: { id: 'creator-open' } as Plan['creator'] }),
  ];
  const snapshot = JSON.stringify(input);
  expect(ids(groupIntoFeedItems(input))).toEqual([['open', 'full']]);
  expect(JSON.stringify(input)).toBe(snapshot);
});

it('collapses a filtered cluster to an ordinary card without inventing missing siblings', () => {
  const visible = plan('visible', new Date(2026, 10, 6, 18), { cluster_root_id: 'unseen-root' });
  expect(groupIntoFeedItems([visible])).toEqual([{ kind: 'standalone', plan: visible }]);
  expect(groupIntoFeedItems([])).toEqual([]);
});

it('does not treat missing creator identities as the same creator', () => {
  const date = new Date(2026, 10, 6, 18);
  const first = plan('a', date, { cluster_root_id: 'root', creator: undefined });
  const second = plan('b', date, { cluster_root_id: 'root', creator: undefined });
  expect(ids(groupIntoFeedItems([first, second]))).toEqual([['a', 'b']]);
});

it('interleaves clusters by their earliest visible plan instead of insertion order', () => {
  const input = [
    plan('late', new Date(2026, 10, 6, 21)),
    plan('cluster-late', new Date(2026, 10, 6, 20), { cluster_root_id: 'root' }),
    plan('early', new Date(2026, 10, 6, 16)),
    plan('cluster-early', new Date(2026, 10, 6, 18), { cluster_root_id: 'root' }),
  ];
  expect(ids(groupIntoFeedItems(input))).toEqual(['early', ['cluster-late', 'cluster-early'], 'late']);
});

it('puts Friday 4 PM in the weekend once, with the previous instant in This Week', () => {
  const defs = getSectionDefs(new Date(2026, 10, 4, 12));
  const input = groupIntoFeedItems([
    plan('week', new Date(2026, 10, 6, 15, 59, 59, 999)),
    plan('weekend', new Date(2026, 10, 6, 16)),
  ]);
  expect(filterIntoSections(input, defs, [], []).map(s => [s.def.key, ids(s.items)])).toEqual([
    ['this-week', ['week']], ['this-weekend', ['weekend']],
  ]);
});

it('keeps the existing recent-start window and changes Today to Tonight at 4 PM', () => {
  const now = new Date(2026, 10, 4, 12);
  const defs = getSectionDefs(now);
  expect(defs[0].title).toBe('Today');
  expect(getSectionDefs(new Date(2026, 10, 4, 16))[0].title).toBe('Tonight');
  const items = groupIntoFeedItems([
    plan('recent', new Date(2026, 10, 4, 9)),
    plan('older', new Date(2026, 10, 4, 8, 59)),
  ]);
  expect(ids(filterIntoSections(items, defs, [], [])[0].items)).toEqual(['recent']);
});

it('preserves category matching for a cluster and applies the selected date section', () => {
  const defs = getSectionDefs(new Date(2026, 10, 4, 12));
  const items = groupIntoFeedItems([
    plan('outdoors', new Date(2026, 10, 6, 18), { cluster_root_id: 'root' }),
    plan('coffee', new Date(2026, 10, 6, 19), { cluster_root_id: 'root', category: 'Coffee' }),
    plan('other', new Date(2026, 10, 6, 20), { category: 'Coffee' }),
  ]);
  const filter = ['outdoors' as CategoryOption];
  expect(filterIntoSections(items, defs, filter, ['this-week'])).toEqual([]);
  expect(filterIntoSections(items, defs, filter, ['this-weekend']).map(s => ids(s.items))).toEqual([[['outdoors', 'coffee']]]);
});

it('keeps next-week and coming-up boundaries disjoint over the year boundary', () => {
  const defs = getSectionDefs(new Date(2026, 11, 31, 12));
  const items = groupIntoFeedItems([
    plan('friday', new Date(2027, 0, 8, 23, 59, 59, 999)),
    plan('saturday', new Date(2027, 0, 9)),
  ]);
  expect(filterIntoSections(items, defs, [], []).map(s => [s.def.key, ids(s.items)])).toEqual([
    ['next-week', ['friday']], ['coming-up', ['saturday']],
  ]);
});
