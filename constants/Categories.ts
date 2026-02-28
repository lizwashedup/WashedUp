/**
 * Shared category list for Plans and Scene filter dropdowns.
 * Must stay in sync between both screens.
 */
export const CATEGORY_OPTIONS = [
  'Music',
  'Food',
  'Outdoors',
  'Nightlife',
  'Film',
  'Art',
  'Fitness',
  'Comedy',
  'Wellness',
  'Sports',
  'Community',
] as const;

export type CategoryOption = (typeof CATEGORY_OPTIONS)[number];
