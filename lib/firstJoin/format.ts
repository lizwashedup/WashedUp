/**
 * Display formatting for first-join cards. Plans live on an LA clock, so the
 * meta row renders the stored instant in America/Los_Angeles regardless of
 * device timezone (mirrors formatDateTimeForCard in FeaturedEventCard).
 * Everything is lowercased per the first-join voice rules (spec b4).
 */

const META_SEPARATOR = ' · '; // middle dot

/** "sat" in LA time. */
export function laWeekdayLower(startTimeIso: string): string {
  const d = new Date(startTimeIso);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' })
    .toLowerCase();
}

/** "5:30 pm" in LA time. */
export function laTimeLower(startTimeIso: string): string {
  const d = new Date(startTimeIso);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleTimeString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase()
    .replace(/[\u202f\u00a0]/g, " "); // some JS engines emit a narrow no-break space before am/pm
}

/** "sat · 5:30 pm · echo park"; neighborhood segment drops out when null. */
export function formatFirstJoinMeta(startTimeIso: string, neighborhood: string | null): string {
  const segments = [laWeekdayLower(startTimeIso), laTimeLower(startTimeIso)];
  if (neighborhood) segments.push(neighborhood.toLowerCase());
  return segments.filter(Boolean).join(META_SEPARATOR);
}
