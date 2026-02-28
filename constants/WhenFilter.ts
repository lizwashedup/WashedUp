/**
 * Shared When filter options for Plans and Scene screens.
 * Must stay in sync between both screens.
 */
export const WHEN_OPTIONS = [
  { key: 'tonight', label: 'Tonight' },
  { key: 'this-weekend', label: 'This Weekend' },
  { key: 'next-week', label: 'Next Week' },
  { key: 'coming-up', label: 'Coming Up' },
] as const;

export type WhenKey = (typeof WHEN_OPTIONS)[number]['key'];
