export const AGE_RANGES = ['All Ages', '21+', '20s', '30s', '40s', '50s', '60s', '70+'] as const;
export type AgeRange = typeof AGE_RANGES[number];

const AGE_BUCKETS: Record<Exclude<AgeRange, 'All Ages'>, [number, number]> = {
  '21+': [21, 99],
  '20s': [20, 29],
  '30s': [30, 39],
  '40s': [40, 49],
  '50s': [50, 59],
  '60s': [60, 69],
  '70+': [70, 99],
};

export function ageRangesToMinMax(ranges: AgeRange[]): { min: number | null; max: number | null } {
  if (ranges.length === 0 || ranges.includes('All Ages')) return { min: null, max: null };
  let min = 99, max = 0;
  for (const r of ranges) {
    const b = AGE_BUCKETS[r as Exclude<AgeRange, 'All Ages'>];
    if (b) {
      if (b[0] < min) min = b[0];
      if (b[1] > max) max = b[1];
    }
  }
  return { min, max };
}

export function minMaxToAgeRanges(min: number | null, max: number | null): AgeRange[] {
  if (min === null && max === null) return ['All Ages'];
  const entries = Object.entries(AGE_BUCKETS) as [Exclude<AgeRange, 'All Ages'>, [number, number]][];
  for (const [range, [bMin, bMax]] of entries) {
    if (bMin === min && bMax === max) return [range];
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [a, [aMin, aMax]] = entries[i];
      const [b, [bMin, bMax]] = entries[j];
      if (Math.min(aMin, bMin) === min && Math.max(aMax, bMax) === max) {
        return [a, b];
      }
    }
  }
  return []; // Saved bounds do not fit a preset; keep them until explicitly changed.
}
