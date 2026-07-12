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

// Minutes east of UTC for the America/Los_Angeles zone at a given instant
// (-420 during PDT, -480 during PST). Derived from Intl so it always tracks the
// real DST rules without a tz library.
function laOffsetForInstant(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(m.year), Number(m.month) - 1, Number(m.day),
    Number(m.hour) % 24, Number(m.minute), Number(m.second),
  );
  return (asUTC - date.getTime()) / 60000;
}

// Combine LA wall-clock fields (what the calendar + time picker show) with the
// LA UTC offset for THAT date, yielding the correct absolute instant regardless
// of the device timezone. Plans live on an LA clock: "11pm" must mean 11pm in
// Los Angeles whether the phone is set to LA or New York.
export function laWallTimeToUTC(
  year: number, month0: number, day: number, hour24: number, minute: number,
): Date {
  const wallAsUTC = Date.UTC(year, month0, day, hour24, minute);
  // First pass: correct by the offset at the naive instant. Re-check the offset
  // at the corrected instant so a wall time sitting right on a DST boundary
  // (the spring-forward gap / fall-back overlap) still resolves correctly.
  const off1 = laOffsetForInstant(new Date(wallAsUTC));
  let utc = wallAsUTC - off1 * 60000;
  const off2 = laOffsetForInstant(new Date(utc));
  if (off2 !== off1) utc = wallAsUTC - off2 * 60000;
  return new Date(utc);
}

// LA-zone {y, m(0-indexed), d} for any instant. Mirrors getTodayInLA for an
// arbitrary timestamp so callers can bucket plans by their LA calendar day
// (used by the When-chip calendar to mark days that have plans).
export function getLADayParts(when: Date | string | number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(when));
  const get = (k: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === k)!.value);
  return { y: get('year'), m: get('month') - 1, d: get('day') };
}

// LA wall-clock parts (day AND time) for any instant. The rehydrate side of
// laWallTimeToUTC: a stored start_time comes back as the LA calendar day and
// LA clock time it was composed from, regardless of the device timezone.
// Reading the day from the UTC side of a timestamp shifts any 5pm-or-later
// LA time one day forward (the draft/prefill date-shift bug).
export function getLAWallParts(
  when: Date | string | number,
): { y: number; m: number; d: number; hour24: number; minute: number } | null {
  const date = new Date(when);
  if (isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (k: 'year' | 'month' | 'day' | 'hour' | 'minute') =>
    Number(parts.find((p) => p.type === k)!.value);
  return {
    y: get('year'), m: get('month') - 1, d: get('day'),
    // Intl reports midnight as 24 with hour12: false on some engines.
    hour24: get('hour') % 24, minute: get('minute'),
  };
}

// A full timestamp on the LA clock, warm and short: "Jul 11, 6:03 pm".
// Replaces bare toLocaleString() (device zone, device locale, seconds).
export function formatTimestampLA(iso: string | null | undefined): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (isNaN(parsed.getTime())) return '';
  return parsed
    .toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    // the space before AM/PM can be a narrow no-break space, so match bare
    .replace('AM', 'am')
    .replace('PM', 'pm');
}

// Stable key for a calendar day (LA), for marked-day sets + selection compares.
export function dayKey(y: number, m: number, d: number): string {
  return `${y}-${m}-${d}`;
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

/**
 * Format a date-only string (YYYY-MM-DD, the explore_events.event_date shape)
 * pinned to Los Angeles regardless of the device timezone. Anchors the day at
 * UTC noon (always the same calendar day in LA) and formats with an explicit
 * LA timeZone, so a date-only value can never render off by one. Full ISO
 * timestamps format directly in LA time. The web/RN parity lane hit the same
 * bug class on plan cards; both branches should converge on this helper.
 */
export function formatEventDateLA(
  dateStr: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' },
): string {
  if (!dateStr) return '';
  const withTZ: Intl.DateTimeFormatOptions = { timeZone: 'America/Los_Angeles', ...options };
  if (dateStr.includes('T')) {
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-US', withTZ);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', withTZ);
}
