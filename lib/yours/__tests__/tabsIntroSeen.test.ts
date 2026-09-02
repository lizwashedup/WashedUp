/**
 * Yours tabs education pop-up: which variant (if any) applies to a given
 * screen state. Mirrors lib/firstJoin/__tests__/onboardingGate.test.ts's
 * shape for a small pure routing function.
 */
import { resolveYoursIntroVariant } from '../tabsIntroSeen';

describe('resolveYoursIntroVariant', () => {
  it('shows nothing while the screen state is still loading', () => {
    expect(resolveYoursIntroVariant('loading')).toBeNull();
  });

  it('treats "empty" (no people, no plan history) as the new-user guide', () => {
    expect(resolveYoursIntroVariant('empty')).toBe('newUser');
  });

  it.each(['fresh', 'populated'] as const)(
    'treats "%s" (real usage history already) as the existing-user pop-up',
    (state) => {
      expect(resolveYoursIntroVariant(state)).toBe('existingUser');
    },
  );
});
