/**
 * WashedUp — Group size limits
 * Plans are always 3–8 people. Display caps prevent bad data from showing wrong counts.
 * Featured events (WashedUp Events) allow 50–500 capacity and bypass MAX_GROUP.
 */

export const MIN_GROUP = 3;
export const MAX_GROUP = 8;
export const FEATURED_MIN_CAPACITY = 50;
export const FEATURED_MAX_CAPACITY = 500;
export const FEATURED_DEFAULT_CAPACITY = 100;

/** Cap displayed member count to never exceed MAX_GROUP (e.g. bad data, aggregated plans). */
export function capDisplayCount(count: number | null | undefined, isFeatured?: boolean): number {
  if (count == null || typeof count !== 'number') return 0;
  if (isFeatured) return Math.max(0, Math.floor(count));
  return Math.min(Math.max(0, Math.floor(count)), MAX_GROUP);
}
