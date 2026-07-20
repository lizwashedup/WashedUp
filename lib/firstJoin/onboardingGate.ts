/**
 * Access gate for the /onboarding/first-week route (spec a2). The screen is
 * the final onboarding step and ONLY the post-photo transition may mount it:
 * the photo step navigates with ?from=onboarding after flipping
 * onboarding_status to 'complete'. Existing users deep-linking or resuming
 * never see it; they land on Scene. Unfinished users are sent back into
 * onboarding. Never blocks: every branch has a destination.
 */

export const FIRST_WEEK_FROM_PARAM = 'onboarding';

/** Where "later" and back land from the first-week screen. */
export const SCENE_ROUTE = '/(tabs)/explore' as const;

/** Where the wishlist confirmation lands: the capture is about plans opening
 * near you, so its exit goes to Plans (founder ruling 7-19). */
export const PLANS_ROUTE = '/(tabs)/plans' as const;

export type FirstWeekAccess =
  | { kind: 'show' }
  | { kind: 'redirect'; to: typeof SCENE_ROUTE }
  | { kind: 'resume_onboarding' };

export function resolveFirstWeekAccess(args: {
  fromParam: string | undefined;
  onboardingStatus: string | null | undefined;
}): FirstWeekAccess {
  const { fromParam, onboardingStatus } = args;

  // Not the post-photo transition (deep link, stale nav, existing user): Scene.
  if (fromParam !== FIRST_WEEK_FROM_PARAM) return { kind: 'redirect', to: SCENE_ROUTE };

  // Photo step just set 'complete'; anything else means onboarding is not
  // actually finished, so resume it rather than showing a join prompt.
  if (onboardingStatus !== 'complete') return { kind: 'resume_onboarding' };

  return { kind: 'show' };
}
