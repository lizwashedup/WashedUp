import { authedDest, onboardingDest } from '../authRouting';

describe('auth routing regression lock', () => {
  it('gates only a definite server-confirmed migration requirement', () => {
    for (const needsPhone of [false, null, undefined]) {
      expect(authedDest({
        onboarding_status: 'complete',
        referral_source: 'friend',
        needs_phone_migration: needsPhone,
      })).toBe('/(tabs)/plans');
    }
    expect(authedDest({
      onboarding_status: 'complete',
      referral_source: 'friend',
      needs_phone_migration: true,
    })).toBe('/migration-gate');
  });

  it('preserves returning-user and onboarding destinations', () => {
    expect(onboardingDest('complete', 'friend')).toBe('/(tabs)/plans');
    expect(onboardingDest('photo', null)).toBe('/onboarding/referral');
    expect(onboardingDest('waitlisted', 'friend')).toBe('/onboarding/waitlisted');
  });
});
