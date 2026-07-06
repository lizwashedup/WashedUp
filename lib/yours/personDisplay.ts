/**
 * People redesign: display derivations from the EXISTING get_yours_grid data.
 *
 * The People & Circles redesign asks for "recently active", a variable-reward
 * sub-info per cell (upcoming / milestone / quiet / count), and an upcoming
 * label. All of it derives from fields we already return; NO new backend. We
 * keep our data mapping; this is the single place the visual states are computed
 * so the warm row, the grid cell, and any future surface agree.
 */
import type { YoursGridPerson } from './types';

export type PersonInfoType = 'upcoming' | 'milestone' | 'quiet' | 'count';

// Intl constructors are expensive on Hermes and these run once per grid cell
// per render; build each formatter once, lazily (inside the try so a bad
// environment degrades to '' instead of crashing at import).
let dayFmt: Intl.DateTimeFormat | null = null;
let nameCollator: Intl.Collator | null = null;

/** "TUE": weekday on the LA clock plans live on, uppercased for the pill. */
export function shortDay(iso: string | null): string {
  if (!iso) return '';
  try {
    dayFmt ??= new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
    });
    return dayFmt.format(new Date(iso)).toUpperCase();
  } catch {
    return '';
  }
}

/** Accent/case-insensitive first-name order for the everyone grid. */
export function compareByFirstName(a: YoursGridPerson, b: YoursGridPerson): number {
  nameCollator ??= new Intl.Collator(undefined, { sensitivity: 'base' });
  return nameCollator.compare(
    a.first_name_display ?? '',
    b.first_name_display ?? '',
  );
}

/**
 * Recently active = the top recency bucket (ring_bucket 'full' ≈ active in the
 * last ~2 weeks). Drives the "recently with you" warm hero row.
 */
export function isRecentlyActive(p: YoursGridPerson): boolean {
  return p.ring_bucket === 'full';
}

/**
 * Variable-reward sub-info, in precedence order (matches the design brief):
 * upcoming plan > milestone count > quiet (drifted) > plain count.
 * NOTE: we deliberately ignore the RPC's `milestone` STRING (the retired tier
 * label "Regular thing" etc.); the redesign's "milestone" is an honest plan
 * count celebration, never a status tier.
 */
export function personInfoType(p: YoursGridPerson): PersonInfoType {
  if (p.upcoming_title && p.upcoming_start) return 'upcoming';
  if (p.shared_count >= 10 && p.shared_count % 5 === 0) return 'milestone';
  if (p.ring_bucket === '25' || p.ring_bucket === 'none') return 'quiet';
  return 'count';
}

/** "TUE · Sunset Club LA": the gold upcoming pill content. */
export function upcomingLabel(p: YoursGridPerson): string {
  if (!p.upcoming_title) return '';
  const day = shortDay(p.upcoming_start);
  return day ? `${day} · ${p.upcoming_title}` : p.upcoming_title;
}

/** First initial for the avatar fallback. */
export function initialOf(name: string | null): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}
