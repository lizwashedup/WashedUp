/**
 * WashedUp — auth routing helpers.
 *
 * Single source of truth for "where should the user go?" decisions.
 * Used by app/_layout.tsx (initial auth check + auth state change) and
 * by app/(auth)/verify-code.tsx (post-OTP routing). Keeping the logic
 * here avoids drift between the two places that route a freshly-authed
 * user.
 */

import { PHONE_AUTH_ENABLED } from '../constants/FeatureFlags';
import { isMigrationGateSnoozed } from './migrationGateSnooze';

/** Route to send unauthenticated users. Toggles with the feature flag. */
export function unauthedRoute(): string {
  return PHONE_AUTH_ENABLED ? '/phone-entry' : '/login';
}

/**
 * Resume an authed user at the right point in onboarding.
 *
 * Backstops:
 *   - older clients reached 'photo'/'vibes' without going through referral
 *     (added 2026-04-08); bounce back to referral first.
 *   - 'vibes' is no longer a screen; route those users to 'photo' so they
 *     can finish in the new shorter flow. Safe to delete next release.
 * 'complete' is intentionally excluded — don't interrupt active users
 * for a data backfill.
 */
export function onboardingDest(
  status: string | null | undefined,
  referralSource: string | null | undefined,
): string {
  if (!referralSource && (status === 'photo' || status === 'vibes')) {
    return '/onboarding/referral';
  }
  switch (status) {
    case 'complete': return '/(tabs)/plans';
    case 'vibes': return '/onboarding/photo'; // legacy: vibes removed from onboarding
    case 'photo': return '/onboarding/photo';
    case 'referral': return '/onboarding/referral';
    case 'la_check': return '/onboarding/la-check';
    case 'waitlisted': return '/onboarding/waitlisted';
    default: return '/onboarding/basics';
  }
}

/**
 * Top-level destination for a freshly-authed user. Layers the migration
 * gate on top of onboardingDest: a user who has completed onboarding
 * but doesn't yet have a phone number on their profile gets routed to
 * /migration-gate (when phone auth is enabled and they haven't snoozed
 * this session).
 */
export function authedDest(args: {
  onboarding_status: string | null | undefined;
  referral_source: string | null | undefined;
  phone_number: string | null | undefined;
}): string {
  const { onboarding_status, referral_source, phone_number } = args;
  if (
    PHONE_AUTH_ENABLED &&
    onboarding_status === 'complete' &&
    !phone_number &&
    !isMigrationGateSnoozed()
  ) {
    return '/migration-gate';
  }
  return onboardingDest(onboarding_status, referral_source);
}
