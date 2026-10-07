import { NEIGHBORHOOD_OPTIONS } from '../constants/Neighborhoods';
import { EVENT_CATEGORIES } from './eventCategories';

/** Creator choices; discovery shows only the choices on currently live pages. */
export const COMMUNITY_AREAS: readonly string[] = [...NEIGHBORHOOD_OPTIONS, 'Many places around LA'];
export const COMMUNITY_CATEGORIES: readonly string[] = [...EVENT_CATEGORIES];
export interface CommunityClassification {
  discovery_area?: string | null;
  categories?: string[] | null;
}
export function communityClassificationProblems(value: { discovery_area?: unknown; categories?: unknown }) {
  const errors: Record<string, string> = {};
  if (typeof value.discovery_area !== 'string' || !COMMUNITY_AREAS.includes(value.discovery_area)) {
    errors.discovery_area = 'Choose an area in LA, or Many places around LA.';
  }
  if (!Array.isArray(value.categories) || value.categories.length < 1 || value.categories.length > 2
    || new Set(value.categories).size !== value.categories.length
    || value.categories.some(category => typeof category !== 'string' || !COMMUNITY_CATEGORIES.includes(category))) {
    errors.categories = 'Choose one or two categories for your community.';
  }
  return errors;
}
