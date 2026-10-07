import { getLAWallParts } from './laDate';
import { MAX_GROUP } from '../constants/GroupLimits';

type OriginalRules = {
  start_time: string; end_time: string | null;
};
type DraftRules = {
  timeChanged: boolean; proposedStart: Date;
  ageChanged: boolean; ages: {min:number|null;max:number|null};
  circlePlan: boolean; groupChanged: boolean; maxInvites: number;
  officialCreator: boolean; featuredChanged: boolean; featured: boolean;
  featuredType: 'washedup_event'|'birthday_party'|'special_event'; featuredCapacity: number;
};
/** Only send rules the creator actually edited. Title-only changes must not
 * erase saved custom bounds, rewrite a DST-fold instant, or change Circle caps. */
export function buildPlanEditRulePatch(original: OriginalRules, draft: DraftRules): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (draft.ageChanged) {
    patch.target_age_min=draft.ages.min; patch.target_age_max=draft.ages.max;
  }
  if (draft.timeChanged) {
    const start=Date.parse(original.start_time), next=draft.proposedStart.getTime();
    if (!Number.isFinite(start)||!Number.isFinite(next)) throw new Error('Choose a valid date and time.');
    const previousWall=getLAWallParts(original.start_time), nextWall=getLAWallParts(draft.proposedStart.toISOString());
    const sameMinute=previousWall && nextWall && previousWall.y===nextWall.y && previousWall.m===nextWall.m && previousWall.d===nextWall.d && previousWall.hour24===nextWall.hour24 && previousWall.minute===nextWall.minute;
    if (!sameMinute) {
      patch.start_time = draft.proposedStart.toISOString();
      if (original.end_time !== null) {
        const duration = Date.parse(original.end_time) - start;
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('This plan’s end time needs to be corrected before its date can change.');
        const end = new Date(next + duration);
        if (!Number.isFinite(end.getTime())) throw new Error('Choose a valid date and time.');
        patch.end_time = end.toISOString();
      }
    }
  }
  // Whole-Circle size and public outsider allowance are different rules.
  // This ordinary/Featured editor cannot edit either Circle capacity contract.
  if (!draft.circlePlan) {
    if (draft.officialCreator && draft.featuredChanged) {
      patch.is_featured=draft.featured;
      patch.featured_type=draft.featured?draft.featuredType:null;
      patch.max_invites=draft.featured?draft.featuredCapacity-1:Math.min(draft.maxInvites,MAX_GROUP-1);
    } else if (draft.groupChanged && !draft.featured) patch.max_invites=draft.maxInvites;
  }
  return patch;
}
export function savedAgeLabel(min: number | null, max: number | null): string {
  if (min===null && max===null) return 'All ages';
  if (min===null) return `Ages up to ${max}`;
  if (max===null) return `Ages ${min}+`;
  return `Ages ${min}–${max}`;
}
