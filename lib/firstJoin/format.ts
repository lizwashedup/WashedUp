/**
 * Display formatting for first-join cards. Plans live on an LA clock, so the
 * meta row renders the stored instant in America/Los_Angeles regardless of
 * device timezone (mirrors formatDateTimeForCard in FeaturedEventCard).
 * Everything is lowercased per the first-join voice rules (spec b4).
 */

import { NEIGHBORHOOD_OTHER } from '../../constants/Neighborhoods';

const META_SEPARATOR = ' · '; // middle dot

/** "sat" in LA time. */
export function laWeekdayLower(startTimeIso: string): string {
  const d = new Date(startTimeIso);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' })
    .toLowerCase();
}

/** "sat, jul 26" in LA time (real date on the card, founder ruling 7-19). */
export function laDateLower(startTimeIso: string): string {
  const d = new Date(startTimeIso);
  if (Number.isNaN(d.getTime())) return '';
  const weekday = d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' });
  const monthDay = d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });
  return `${weekday}, ${monthDay}`.toLowerCase();
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

/**
 * "sat, jul 26 · 7:00 am · los feliz". The neighborhood segment drops out
 * when null or "Other": never print "other" (founder ruling 7-19).
 */
export function formatFirstJoinMeta(startTimeIso: string, neighborhood: string | null): string {
  const segments = [laDateLower(startTimeIso), laTimeLower(startTimeIso)];
  if (neighborhood && neighborhood !== NEIGHBORHOOD_OTHER) segments.push(neighborhood.toLowerCase());
  return segments.filter(Boolean).join(META_SEPARATOR);
}
