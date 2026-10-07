import { planAgeLabel } from '../planAgeLabel';

it.each([
  [20, 39, '20s–30s'],
  [30, 39, '30s'],
  [20, 29, '20s'],
  [40, 69, '40s–60s'],
  [21, null, '21+'],
  [70, null, '70+'],
  [null, null, 'Any age'],
  [25, 35, '25–35'],
  [20, 35, '20–35'],
  [21, 39, '21–39'],
  [21, 99, '21+'],
  [70, 99, '70+'],
  [20, 99, '20+'],
  [null, 35, 'Up to 35'],
  [30, 30, '30'],
] as const)('labels saved %s / %s bounds as %s without broadening them', (min, max, expected) => {
  expect(planAgeLabel({ target_age_min: min, target_age_max: max })).toBe(expected);
});

it.each(['Everyone', 'All Ages', ' Any age ', 'unrestricted'])('recognizes an explicit unrestricted legacy value: %s', age_range => {
  expect(planAgeLabel({ age_range })).toBe('Any age');
});

it.each([
  {},
  { age_range: '' },
  { age_range: null },
  { age_range: 'something unknown' },
  { age_range: '30s' },
  { target_age_min: null },
  { target_age_max: null },
  { target_age_min: 21 },
  { target_age_max: 39 },
  { target_age_min: 40, target_age_max: 30 },
  { target_age_min: 100, target_age_max: 99 },
  { target_age_min: -1, target_age_max: null },
  { target_age_min: 20.5, target_age_max: 39 },
  { target_age_min: NaN, target_age_max: null },
  { target_age_min: 21, target_age_max: Infinity },
  { target_age_min: 21, target_age_max: Number.MAX_SAFE_INTEGER + 1 },
  { target_age_min: '21', target_age_max: null },
  { target_age_min: false, target_age_max: null },
  { target_age_min: 21, age_range: 'All Ages' },
  { target_age_min: 'bad', target_age_max: null, age_range: 'Everyone' },
])('never calls unloaded or malformed restrictions unrestricted: %j', raw => {
  expect(planAgeLabel(raw as Parameters<typeof planAgeLabel>[0])).toBeNull();
});

it('prefers the actual numeric restriction over a stale legacy default without mutating it', () => {
  const plan = Object.freeze({ target_age_min: 30, target_age_max: 39, age_range: 'All Ages' });
  expect(planAgeLabel(plan)).toBe('30s');
  expect(plan).toEqual({ target_age_min: 30, target_age_max: 39, age_range: 'All Ages' });
});
