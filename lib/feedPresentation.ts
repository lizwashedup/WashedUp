import type { Plan } from './fetchPlans';
import { isPlanPast } from './planTime';

/** Input rows are already server-authorized. Ownership never hides a row. */
export function plansOutsideFeatured(plans: Plan[], featured: { id: string }[], now = Date.now()): Plan[] {
  const renderedIds = new Set(featured.map(plan => plan.id));
  return plans.filter(plan => !renderedIds.has(plan.id) && !isPlanPast(plan.start_time, plan.end_time, now));
}
