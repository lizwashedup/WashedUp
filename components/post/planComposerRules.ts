import { getTodayInLA, laWallTimeToUTC } from '../../lib/laDate';

export type GenderPreference = 'mixed' | 'women_only' | 'men_only' | 'nonbinary_only';

export const AGE_RANGES = ['All Ages', '21+', '20s', '30s', '40s', '50s', '60s', '70+'] as const;
export type AgeRange = (typeof AGE_RANGES)[number];

export const MIN_GROUP = 3;
export const MAX_GROUP = 8;
export const MSG_MIN = 10;
export const MSG_LIMIT = 150;
export const DESC_LIMIT = 2000;
// Counter turns to the warm warn color once you're within this many chars of the cap.
export const DESC_WARN_MARGIN = 200;

export type QuickKind = 'tonight' | 'tomorrow';

export function buildDatetime(
  month: number, day: number, year: number,
  hour: number, minute: string, period: 'AM' | 'PM',
): Date {
  let h = hour;
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  // Pin to the LA wall clock, not the device's local zone (see laDate).
  return laWallTimeToUTC(year, month, day, h, parseInt(minute, 10));
}

export function ageRangesToMinMax(ranges: AgeRange[]): { min: number | null; max: number | null } {
  if (ranges.length === 0 || ranges.includes('All Ages')) return { min: null, max: null };
  const bounds: Record<string, [number, number]> = {
    '21+': [21, 99], '20s': [20, 29], '30s': [30, 39], '40s': [40, 49],
    '50s': [50, 59], '60s': [60, 69], '70+': [70, 99],
  };
  let min = 99, max = 0;
  for (const r of ranges) {
    const b = bounds[r];
    if (b) { if (b[0] < min) min = b[0]; if (b[1] > max) max = b[1]; }
  }
  return { min, max };
}

/** Date (LA-local) for a quick chip. Tonight = today, tomorrow = +1. Both are
 *  unambiguous one-tap paths; everything else uses the calendar row. */
export function quickDate(kind: QuickKind): { year: number; month: number; day: number } {
  const t = getTodayInLA();
  const base = new Date(t.y, t.m, t.d);
  if (kind === 'tomorrow') base.setDate(base.getDate() + 1);
  return { year: base.getFullYear(), month: base.getMonth(), day: base.getDate() };
}

export function sameDay(a: { year: number; month: number; day: number } | null, b: { year: number; month: number; day: number }): boolean {
  return !!a && a.year === b.year && a.month === b.month && a.day === b.day;
}

