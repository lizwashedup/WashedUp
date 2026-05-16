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
 * Top-level destination for a freshly-authed user. Layers a hard phone
 * gate on top of onboardingDest: ANY authed user without a verified
 * phone is routed to /migration-gate (when phone auth is enabled),
 * regardless of onboarding status or account age. There is no skip and
 * no snooze — a phone is mandatory to use the app. New users sign up
 * phone-first so they already have one; this targets the legacy
 * email/Apple/invited population that has none.
 *
 * `auth_phone` MUST be auth.users.phone (i.e. session.user.phone), not
 * profiles.phone_number. Supabase only writes auth.users.phone after a
 * successful verifyOtp, so it's the one column that means "this person
 * has a verified phone." profiles.phone_number is a denormalization —
 * legacy email/Apple users may have a non-null string there from old
 * signup forms, and brand-new phone signups land with phone_verified=false
 * because handle_new_user doesn't set it. Reading from auth.users.phone
 * avoids both traps.
 */
export function authedDest(args: {
  onboarding_status: string | null | undefined;
  referral_source: string | null | undefined;
  auth_phone: string | null | undefined;
}): string {
  const { onboarding_status, referral_source, auth_phone } = args;
  if (PHONE_AUTH_ENABLED && !auth_phone) {
    return '/migration-gate';
  }
  return onboardingDest(onboarding_status, referral_source);
}
