/**
 * Compatibility gate for a saved /onboarding/first-week route. New signups
 * now open Plans directly after photo completion. Previously saved explicit
 * onboarding transitions can still finish this screen; other entries go to
 * Plans, where the existing tabs guard enforces onboarding completion.
 */

export const FIRST_WEEK_FROM_PARAM = 'onboarding';

/** Every completed-onboarding exit opens the Plans feed. */
export const PLANS_ROUTE = '/(tabs)/plans' as const;

export type FirstWeekAccess =
  | { kind: 'show' }
  | { kind: 'redirect'; to: typeof PLANS_ROUTE }
  | { kind: 'resume_onboarding' };

export function resolveFirstWeekAccess(args: {
  fromParam: string | undefined;
  onboardingStatus: string | null | undefined;
}): FirstWeekAccess {
  const { fromParam, onboardingStatus } = args;

  // Not the post-photo transition (deep link, stale nav, existing user): Plans.
  if (fromParam !== FIRST_WEEK_FROM_PARAM) return { kind: 'redirect', to: PLANS_ROUTE };

  // A saved onboarding transition must still be complete; otherwise it is not
  // actually finished, so resume it rather than showing a join prompt.
  if (onboardingStatus !== 'complete') return { kind: 'resume_onboarding' };

  return { kind: 'show' };
}
