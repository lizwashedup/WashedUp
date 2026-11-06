import type { Plan } from './fetchPlans';
import { isPlanPast } from './planTime';

/** Input rows are already server-authorized. Ownership never hides a row. */
export function plansOutsideFeatured(plans: Plan[], featured: { id: string }[], now = Date.now()): Plan[] {
  const renderedIds = new Set(featured.map(plan => plan.id));
  return plans.filter(plan => !renderedIds.has(plan.id) && !isPlanPast(plan.start_time, plan.end_time, now));
}

// Featured cards stay above the date/category/distance-filtered list. A raw
// feed row may be past or already in Featured, so its count cannot tell us
// whether the member applied a filter or whether the screen is empty.
export function getFeedEmptyCopy({ hasFeatured, whenOrCategory, nearMe, redesigned }: {
  hasFeatured: boolean; whenOrCategory: boolean; nearMe: boolean; redesigned: boolean;
}) {
  if (whenOrCategory) return {
    title: hasFeatured ? 'No other plans match your filters.' : 'No plans match your filters.',
    detail: redesigned ? 'Try clearing your filters, or post a plan of your own.' : null,
  };
  if (nearMe) return {
    title: hasFeatured ? 'No other plans nearby.' : redesigned ? 'Make a plan nearby.' : 'Nothing quite that close yet.',
    detail: redesigned ? 'Try a wider distance, or post something close to you.'
      : "We're still growing in LA. Post your own and share it around. That's how the map fills in.",
  };
  if (hasFeatured) return null;
  return {
    title: redesigned ? 'What would you like to do?' : 'No upcoming plans yet.',
    detail: redesigned ? 'Post a plan and give someone a reason to join you.' : null,
  };
}
