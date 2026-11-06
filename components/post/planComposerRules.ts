import { getTodayInLA, getLAWallParts, isValidLAWallTime, laWallTimeToUTC } from '../../lib/laDate';

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


type WallMinute = NonNullable<ReturnType<typeof getLAWallParts>>;
type ClockMinute = Pick<WallMinute, 'hour24' | 'minute'>;
type SavedSchedule = { start?: string; end?: string };
const calendarDay = (wall: WallMinute) => Date.UTC(wall.y, wall.m, wall.d);
const clockMinute = (wall: ClockMinute) => wall.hour24 * 60 + wall.minute;

function resolveWallMinute(wall: WallMinute, saved?: string): string | null {
  if (saved) {
    const original = getLAWallParts(saved);
    if (original && calendarDay(original) === calendarDay(wall) &&
        original.hour24 === wall.hour24 && original.minute === wall.minute) return saved;
  }
  const args = [wall.y, wall.m, wall.d, wall.hour24, wall.minute] as const;
  return isValidLAWallTime(...args) ? laWallTimeToUTC(...args).toISOString() : null;
}

/** A reopened plan can contain a second occurrence of a fall-back minute or an
 * end date beyond the overnight picker. Retain those values while editing. */
export function resolveMemberPlanSchedule(start: WallMinute, end: ClockMinute | null, saved: SavedSchedule) {
  const startIso = resolveWallMinute(start, saved.start);
  if (!end || !startIso) return { startIso, endIso: null, endDayLabel: null };
  const originalStart = saved.start && getLAWallParts(saved.start);
  const originalEnd = saved.end && getLAWallParts(saved.end);
  let days = clockMinute(end) <= clockMinute(start) ? 1 : 0;
  if (saved.start && saved.end && originalStart && originalEnd && Date.parse(saved.end) > Date.parse(saved.start)) {
    const originalDays = (calendarDay(originalEnd) - calendarDay(originalStart)) / 86_400_000;
    const originalOvernight = clockMinute(originalEnd) <= clockMinute(originalStart) ? 1 : 0;
    // Keep an explicit multi-day span. Ordinary edited clocks continue to use
    // the normal overnight rule. Identical clocks can also form a DST fold.
    if (originalDays > originalOvernight || (calendarDay(start) === calendarDay(originalStart) &&
        clockMinute(start) === clockMinute(originalStart) && clockMinute(end) === clockMinute(originalEnd))) days = originalDays;
  }
  const endDay = new Date(Date.UTC(start.y, start.m, start.d + days));
  const endIso = resolveWallMinute({ y: endDay.getUTCFullYear(), m: endDay.getUTCMonth(), d: endDay.getUTCDate(), ...end }, saved.end);
  const endDayLabel = days > 0 ? endDay.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : null;
  return { startIso, endIso, endDayLabel };
}
