import Colors from '../constants/Colors';

// Lowercase-keyed category → pin color. DB stores primary_vibe lowercase.
// Categories not listed here fall through to the terracotta default.
export const CATEGORY_PIN_COLORS: Record<string, string> = {
  music: Colors.pinMusic,
  food: Colors.pinFood,
  art: Colors.pinArt,
  outdoors: Colors.pinOutdoors,
  comedy: Colors.pinComedy,
  film: Colors.pinFilm,
  fitness: Colors.pinFitness,
  nightlife: Colors.pinNightlife,
  wellness: Colors.pinWellness,
  books: Colors.pinBooks,
};

export interface PlanColorInput {
  is_featured?: boolean | null;
  featured_type?: 'washedup_event' | 'birthday_party' | string | null;
  category?: string | null;
}

// Priority: WashedUp Event → Birthday Party → category → terracotta fallback.
// Note: happening-now override lives at the call site (map marker), not here,
// so PlanCard's category pill stays its usual color. The feed card already
// shows a separate "happening now" pill from Prompt 1.
export function getPlanPinColor(plan: PlanColorInput | null | undefined): string {
  if (!plan) return Colors.terracotta;
  if (plan.is_featured && plan.featured_type === 'washedup_event') {
    return Colors.pinWashedupEvent;
  }
  if (plan.is_featured && plan.featured_type === 'birthday_party') {
    return Colors.pinBirthdayParty;
  }
  const key = plan.category?.toLowerCase();
  if (key && CATEGORY_PIN_COLORS[key]) return CATEGORY_PIN_COLORS[key];
  return Colors.terracotta;
}

export interface HappeningNowInput {
  start_time: string | null | undefined;
}

// A plan is "happening now" if start_time is in the past but within the
// last 3 hours. Matches the 3h buffer used in the feed RPC and in the
// PlanCard / detail-page banner logic.
export function isHappeningNow(plan: HappeningNowInput | null | undefined): boolean {
  if (!plan?.start_time) return false;
  const t = new Date(plan.start_time).getTime();
  const now = Date.now();
  return t <= now && t > now - 3 * 60 * 60 * 1000;
}
