/**
 * First-week route gate tests: only the post-photo transition shows the
 * screen; everyone else lands somewhere sensible, never a blocked state.
 */
import { FIRST_WEEK_FROM_PARAM, resolveFirstWeekAccess, SCENE_ROUTE } from '../onboardingGate';

describe('resolveFirstWeekAccess', () => {
  it('shows for the post-photo transition (from=onboarding, status complete)', () => {
    expect(
      resolveFirstWeekAccess({ fromParam: FIRST_WEEK_FROM_PARAM, onboardingStatus: 'complete' }),
    ).toEqual({ kind: 'show' });
  });

  it('redirects existing users / deep links (no from param) to Scene', () => {
    expect(resolveFirstWeekAccess({ fromParam: undefined, onboardingStatus: 'complete' })).toEqual({
      kind: 'redirect',
      to: SCENE_ROUTE,
    });
  });

  it('redirects a wrong from param to Scene', () => {
    expect(resolveFirstWeekAccess({ fromParam: 'push', onboardingStatus: 'complete' })).toEqual({
      kind: 'redirect',
      to: SCENE_ROUTE,
    });
  });

  it.each(['pending', 'photo', 'la_check', 'referral', 'waitlisted', null, undefined])(
    'resumes onboarding when status is %s even with the right from param',
    (status) => {
      expect(
        resolveFirstWeekAccess({ fromParam: FIRST_WEEK_FROM_PARAM, onboardingStatus: status as string | null | undefined }),
      ).toEqual({ kind: 'resume_onboarding' });
    },
  );
});
