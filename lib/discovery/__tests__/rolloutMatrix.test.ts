import { isDimensionEnabled, parseRolloutMatrix } from '../rolloutMatrix';

const allowed = new Set(['age', 'audience']);
const matrix = [
  { cityId: 'la', dimension: 'age', enabled: true },
  { cityId: 'la', dimension: 'audience', enabled: false },
  { cityId: 'nyc', dimension: 'audience', enabled: true },
];

describe('city and dimension rollout matrix', () => {
  it('enables only the exact city and dimension pair', () => {
    expect(isDimensionEnabled(matrix, 'la', 'age', allowed)).toBe(true);
    expect(isDimensionEnabled(matrix, 'nyc', 'age', allowed)).toBe(false);
    expect(isDimensionEnabled(matrix, 'la', 'audience', allowed)).toBe(false);
  });

  it('keeps absent and unknown dimensions off', () => {
    expect(isDimensionEnabled(matrix, 'la', 'missing', allowed)).toBe(false);
    expect(isDimensionEnabled([{ cityId: 'la', dimension: 'future', enabled: true }], 'la', 'future', allowed)).toBe(false);
  });

  it('fails closed for duplicate or malformed entries', () => {
    expect(parseRolloutMatrix([matrix[0], matrix[0]])).toBeNull();
    expect(isDimensionEnabled([{ cityId: 'la', dimension: 'age', enabled: 'yes' }], 'la', 'age', allowed)).toBe(false);
  });
});
