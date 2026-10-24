import { checkContent } from './contentFilter';
import { isValidLAWallTime, laWallTimeToUTC } from './laDate';
import { buildPlanEditRulePatch } from './planEditRules';
import { resolveManagePlanImageUrl } from './planPhotoEdit';

export const AGE_RANGES = ['All Ages', '21+', '20s', '30s', '40s', '50s', '60s', '70+'] as const;
export type AgeRange = typeof AGE_RANGES[number];

const AGE_BUCKETS: Record<Exclude<AgeRange, 'All Ages'>, [number, number]> = {
  '21+': [21, 99],
  '20s': [20, 29],
  '30s': [30, 39],
  '40s': [40, 49],
  '50s': [50, 59],
  '60s': [60, 69],
  '70+': [70, 99],
};

function ageRangesToMinMax(ranges: AgeRange[]): { min: number | null; max: number | null } {
  if (ranges.length === 0 || ranges.includes('All Ages')) return { min: null, max: null };
  let min = 99, max = 0;
  for (const r of ranges) {
    const b = AGE_BUCKETS[r as Exclude<AgeRange, 'All Ages'>];
    if (b) {
      if (b[0] < min) min = b[0];
      if (b[1] > max) max = b[1];
    }
  }
  return { min, max };
}

export function minMaxToAgeRanges(min: number | null, max: number | null): AgeRange[] {
  if (min === null && max === null) return ['All Ages'];
  const entries = Object.entries(AGE_BUCKETS) as [Exclude<AgeRange, 'All Ages'>, [number, number]][];
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
  return []; // Saved bounds do not fit a preset; keep them until explicitly changed.
}

export type PlanEditDraft = {
  title: string;
  description: string;
  creatorMessage: string;
  location: string;
  locationLat: number | null;
  locationLng: number | null;
  ticketUrl: string;
  imageUrl: string | null;
  category: string | null;
  genderRule: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: string;
  period: 'AM' | 'PM';
  timeChanged: boolean;
  ageRanges: AgeRange[];
  ageChanged: boolean;
  groupSize: number;
  groupChanged: boolean;
  featured: boolean;
  featuredChanged: boolean;
  featuredType: 'washedup_event' | 'birthday_party' | 'special_event';
  featuredCapacity: number;
};

type EditContext = { circlePlan: boolean; officialCreator: boolean };
type PlanEditPatch = Record<string, string | number | boolean | null>;
type PreparedEdit =
  | { ok: true; patch: PlanEditPatch }
  | { ok: false; title: string; message: string };

/** Prepare the existing Manage Plan payload without UI, requests, or writes.
 * The caller still owns current-account/visit checks and save reconciliation.
 * Untouched schedule, age, and capacity rules remain omitted by planEditRules.
 */
export function preparePlanEdit(
  original: Parameters<typeof buildPlanEditRulePatch>[0],
  draft: PlanEditDraft,
  context: EditContext,
): PreparedEdit {
  const hour24 = draft.hour % 12 + (draft.period === 'PM' ? 12 : 0);
  if (!isValidLAWallTime(draft.year, draft.month, draft.day, hour24, Number(draft.minute))) {
    return {
      ok: false,
      title: 'Choose another time',
      message: 'That date or time does not exist in Los Angeles. Pick a different time.',
    };
  }

  const fieldsToCheck = [draft.title, draft.description, draft.creatorMessage, draft.location].filter(Boolean).join(' ');
  const filter = checkContent(fieldsToCheck);
  if (!filter.ok) {
    return {
      ok: false,
      title: 'Content not allowed',
      message: filter.reason ?? 'Please revise your plan and try again.',
    };
  }

  let proposedHour = draft.hour;
  if (draft.period === 'PM' && proposedHour !== 12) proposedHour += 12;
  if (draft.period === 'AM' && proposedHour === 12) proposedHour = 0;
  const proposedStart = laWallTimeToUTC(draft.year, draft.month, draft.day, proposedHour, parseInt(draft.minute, 10));
  return {
    ok: true,
    patch: {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      host_message: draft.creatorMessage.trim() || null,
      location_text: draft.location.trim() || null,
      location_lat: draft.locationLat,
      location_lng: draft.locationLng,
      tickets_url: draft.ticketUrl.trim() || null,
      image_url: resolveManagePlanImageUrl(draft.imageUrl),
      primary_vibe: draft.category?.toLowerCase() ?? null,
      gender_rule: draft.genderRule,
      ...buildPlanEditRulePatch(original, {
        timeChanged: draft.timeChanged, proposedStart,
        ageChanged: draft.ageChanged, ages: ageRangesToMinMax(draft.ageRanges),
        circlePlan: context.circlePlan, groupChanged: draft.groupChanged, maxInvites: draft.groupSize,
        officialCreator: context.officialCreator, featuredChanged: draft.featuredChanged, featured: draft.featured,
        featuredType: draft.featuredType, featuredCapacity: draft.featuredCapacity,
      }),
    },
  };
}
