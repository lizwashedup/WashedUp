/**
 * WashedUp — Group size limits
 * Plans are always 3–8 people. Display caps prevent bad data from showing wrong counts.
 */

export const MIN_GROUP = 3;
export const MAX_GROUP = 8;

/** Cap displayed member count to never exceed MAX_GROUP (e.g. bad data, aggregated plans). */
export function capDisplayCount(count: number | null | undefined): number {
  if (count == null || typeof count !== 'number') return 0;
  return Math.min(Math.max(0, Math.floor(count)), MAX_GROUP);
}
