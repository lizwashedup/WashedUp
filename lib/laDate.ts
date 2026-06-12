/**
 * LA-anchored date helpers, shared by the composers and WashedUpCalendar.
 *
 * Plans live on an LA clock, so the calendar disables past days against the
 * America/Los_Angeles boundary regardless of the device timezone. Extracted from
 * the post composer so the calendar code lives in exactly one place.
 */

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Sunday-first single-letter weekday header.
export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// "Today" in America/Los_Angeles, as 0-indexed month + day-of-month + year.
export function getTodayInLA(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date());
  const get = (k: 'year' | 'month' | 'day') =>
    Number(parts.find((p) => p.type === k)!.value);
  return { y: get('year'), m: get('month') - 1, d: get('day') };
}

export function isBeforeTodayLA(y: number, m: number, d: number): boolean {
  const t = getTodayInLA();
  if (y !== t.y) return y < t.y;
  if (m !== t.m) return m < t.m;
  return d < t.d;
}

export function getDaysInMonth(month: number, year: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// Sunday-first month grid: rows of 7, leading/trailing nulls for cells that
// don't belong to the displayed month.
export function buildMonthGrid(year: number, month: number): (number | null)[][] {
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = getDaysInMonth(month, year);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
