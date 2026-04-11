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
