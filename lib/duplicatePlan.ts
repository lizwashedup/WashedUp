/**
 * Shared "post your own" (duplicate) navigation params builder.
 *
 * Both the duplicate bottom sheet in app/plan/[id].tsx and the "Post your own"
 * button on feed plan cards (components/plans/PlanCard.tsx) push the user to
 * /(tabs)/post with the original plan's fields pre-filled. Keeping the param
 * construction in one place guarantees the two entry points stay byte-identical
 * and can't drift.
 */

const AGE_RANGES = ['All Ages', '21+', '20s', '30s', '40s', '50s', '60s', '70+'] as const;
type AgeRange = (typeof AGE_RANGES)[number];

const AGE_BUCKETS: Record<Exclude<AgeRange, 'All Ages'>, [number, number]> = {
  '21+': [21, 99],
  '20s': [20, 29],
  '30s': [30, 39],
  '40s': [40, 49],
  '50s': [50, 59],
  '60s': [60, 69],
  '70+': [70, 99],
};

/**
 * Mirror of minMaxToAgeRanges in app/plan/[id].tsx — kept local so this helper
 * is self-contained and the post screen's expectations don't change.
 */
function minMaxToAgeRanges(min: number | null, max: number | null): AgeRange[] {
  if (min === null && max === null) return ['All Ages'];
  const entries = Object.entries(AGE_BUCKETS) as [
    Exclude<AgeRange, 'All Ages'>,
    [number, number],
  ][];
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
  return ['All Ages'];
}

/** The original-plan fields needed to pre-fill the post screen. */
export interface DuplicateSourceEvent {
  title?: string | null;
  description?: string | null;
  location_text?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  neighborhood?: string | null;
  primary_vibe?: string | null;
  image_url?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  drop_in?: boolean | null;
  allow_duplicate?: boolean | null;
  target_age_min?: number | null;
  target_age_max?: number | null;
  gender_rule?: string | null;
  max_invites?: number | null;
  tickets_url?: string | null;
}

/**
 * Builds the exact /(tabs)/post param set used by the duplicate flow.
 * `eventId` is the original plan's id (becomes duplicatedFromEventId).
 */
export function buildDuplicatePostParams(
  event: DuplicateSourceEvent | null | undefined,
  eventId: string | null | undefined,
): Record<string, string> {
  return {
    prefillTitle: event?.title ?? '',
    prefillDescription: event?.description ?? '',
    prefillLocation: event?.location_text ?? '',
    prefillLocationLat: event?.location_lat != null ? String(event.location_lat) : '',
    prefillLocationLng: event?.location_lng != null ? String(event.location_lng) : '',
    prefillNeighborhood: event?.neighborhood ?? '',
    prefillCategory: event?.primary_vibe ?? '',
    prefillImageUrl: event?.image_url ?? '',
    prefillStartTime: event?.start_time ?? '',
    // Date param expects YYYY-MM-DD; sending the full ISO breaks the
    // receiver's parser (silently no-ops).
    prefillEventDate: event?.start_time?.slice(0, 10) ?? '',
    prefillEndTime: event?.end_time ?? '',
    prefillDropIn: event?.drop_in === false ? 'false' : 'true',
    prefillAllowDuplicate: event?.allow_duplicate === false ? 'false' : 'true',
    prefillAgeRange: minMaxToAgeRanges(
      event?.target_age_min ?? null,
      event?.target_age_max ?? null,
    ).join(','),
    prefillGenderPref: event?.gender_rule ?? 'mixed',
    prefillGroupSize: event?.max_invites != null ? String(event.max_invites) : '',
    prefillTicketsUrl: event?.tickets_url ?? '',
    duplicatedFromEventId: eventId ?? '',
  };
}
