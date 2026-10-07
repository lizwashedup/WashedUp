/** Optional until the existing eligible discovery read supplies classification. */
export interface CommunityDiscoveryMetadata {
  id?: string;
  discovery_area?: string | null;
  categories?: readonly string[] | null;
}
export interface CommunityFilterOptions { categories: string[]; areas: string[] }
export const MANY_PLACES_AROUND_LA = 'Many places around LA';
const clean = (value: unknown): string => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const key = (value: unknown): string => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US');
const areaLabel = (value: unknown): string => key(value) === key(MANY_PLACES_AROUND_LA) ? MANY_PLACES_AROUND_LA : clean(value);

/** Call with ALL eligible live rows, before local name/category/area filtering. */
export function communityFilterOptions(communities: readonly CommunityDiscoveryMetadata[]): CommunityFilterOptions {
  const categories = new Map<string, string>(), areas = new Map<string, string>();
  for (const community of communities) {
    for (const category of Array.isArray(community.categories) ? community.categories : []) {
      const label = clean(category);
      if (label && !categories.has(key(label))) categories.set(key(label), label);
    }
    const area = areaLabel(community.discovery_area);
    if (area && !areas.has(key(area))) areas.set(key(area), area);
  }
  const sorted = (values: Map<string, string>) => [...values.values()].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));
  return { categories: sorted(categories), areas: sorted(areas) };
}

/** Missing classification stays visible until an actual classification is chosen. */
export function matchesCommunityFilters(community: CommunityDiscoveryMetadata, filters: { category?: string; area?: string }): boolean {
  if (key(filters.area) && key(community.discovery_area) !== key(filters.area)) return false;
  const categories = Array.isArray(community.categories) ? community.categories : [];
  return !key(filters.category) || categories.some(category => key(category) === key(filters.category));
}

/** Retire unavailable choices instead of adding unavailable options to the sheet. */
export function availableCommunitySelection(filters: { category?: string; area?: string }, options: CommunityFilterOptions) {
  return {
    category: options.categories.find(value => key(value) === key(filters.category)) ?? '',
    area: options.areas.find(value => key(value) === key(filters.area)) ?? '',
  };
}
