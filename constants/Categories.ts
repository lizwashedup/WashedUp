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

/**
 * Composer category set - what a creator can pick when POSTING a plan. Shared
 * by both composer surfaces (main PlanComposerV2 + CirclePlanComposer) and
 * stored on events.primary_vibe (lowercased on submit, matching the legacy
 * composer's inline list). This is intentionally distinct from
 * CATEGORY_OPTIONS above, which is the feed/Scene filter set.
 *
 * Keep in agreement with the legacy composer's inline CATEGORIES (frozen) until
 * legacy is deleted post-flip. Do not add or rename in this pass.
 */
export const PLAN_CATEGORIES = [
  'Art', 'Business', 'Comedy', 'Film', 'Fitness',
  'Food', 'Gaming', 'Music', 'Nightlife', 'Outdoors',
  'Sports', 'Tech', 'Wellness', 'Other',
] as const;

export type PlanCategory = (typeof PLAN_CATEGORIES)[number];
