/**
 * Shared "post your own" (duplicate) navigation params builder.
 *
 * Both the duplicate bottom sheet in app/plan/[id].tsx and the "Post your own"
 * button on feed plan cards (components/plans/PlanCard.tsx) push the user to
 * /(tabs)/post with the original plan's fields pre-filled. Keeping the param
 * construction in one place guarantees the two entry points stay byte-identical
 * and can't drift.
 */

import { minMaxToAgeRanges } from './planEditDraft';
import { getLAWallParts } from './laDate';

// The LA calendar day (YYYY-MM-DD) of a stored timestamp. Never the UTC
// slice: start_time.slice(0, 10) reads the UTC side, which is one day ahead
// of LA for any 5pm-or-later LA time (the draft/prefill date-shift bug).
function laDayString(iso: string | null | undefined): string {
  if (!iso) return '';
  const w = getLAWallParts(iso);
  if (!w) return '';
  const mm = String(w.m + 1).padStart(2, '0');
  const dd = String(w.d).padStart(2, '0');
  return `${w.y}-${mm}-${dd}`;
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
  explore_event_id?: string | null;
}

/**
 * Builds the exact /(tabs)/post param set used by the duplicate flow.
 * `eventId` is the original plan's id (becomes duplicatedFromEventId).
 */
export function buildDuplicatePostParams(
  event: DuplicateSourceEvent | null | undefined,
  eventId: string | null | undefined,
): Record<string, string> {
  const min = event?.target_age_min ?? null;
  const max = event?.target_age_max ?? null;
  const presets = minMaxToAgeRanges(min, max);
  return {
    draftId: '', draftOwnerId: '', draftOpenRequest: '', prefillCreatorMessage: '',
    prefillTitle: event?.title ?? '',
    prefillDescription: event?.description ?? '',
    prefillLocation: event?.location_text ?? '',
    prefillLocationLat: event?.location_lat != null ? String(event.location_lat) : '',
    prefillLocationLng: event?.location_lng != null ? String(event.location_lng) : '',
    prefillNeighborhood: event?.neighborhood ?? '',
    prefillCategory: event?.primary_vibe ?? '',
    prefillImageUrl: event?.image_url ?? '',
    prefillStartTime: event?.start_time ?? '',
    // Date param expects YYYY-MM-DD, taken from the LA side of the timestamp.
    prefillEventDate: laDayString(event?.start_time),
    prefillEndTime: event?.end_time ?? '',
    prefillDropIn: event?.drop_in === false ? 'false' : 'true',
    prefillAllowDuplicate: event?.allow_duplicate === false ? 'false' : 'true',
    prefillAgeRange: presets.join(','),
    prefillCustomAgeMin: !presets.length && min !== null ? String(min) : '',
    prefillCustomAgeMax: !presets.length && max !== null ? String(max) : '',
    prefillGenderPref: event?.gender_rule ?? 'mixed',
    prefillGroupSize: event?.max_invites != null ? String(event.max_invites) : '',
    prefillTicketsUrl: event?.tickets_url ?? '',
    // Carry the explore-event link explicitly rather than leaving it for
    // the DB trigger to guess. auto_link_explore_event only fires when this
    // is null, and (until supabase/migrations/20260901060000_fix_ambiguous_title_link_to_explore_event.sql
    // is ever applied) it can guess WRONG when 2+ Live explore_events share
    // a title (the tour's spawn mislink) -- passing the real id here skips
    // the guess entirely regardless of that fix's status.
    prefillExploreEventId: event?.explore_event_id ?? '',
    duplicatedFromEventId: eventId ?? '',
  };
}
