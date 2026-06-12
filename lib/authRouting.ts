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
 * Top-level destination for a freshly-authed user. Layers the phone gate on
 * top of onboardingDest, but FAILS CLOSED: it routes to /migration-gate ONLY
 * when `needs_phone_migration === true`, a definite server-truthed signal from
 * the `needs_phone_migration()` RPC (an authed user with no confirmed phone on
 * auth.users). Any other value (false / null / undefined, i.e. unknown / timeout
 * / stale / RPC failure) routes to the normal destination and NEVER to the gate.
 *
 * This replaces the old fail-OPEN check (`!auth_phone`, where auth_phone came from
 * the possibly-stale `session.user.phone`): a phone-VERIFIED user whose JWT phone
 * field read null on a slow/stale session was wrongly sent to the gate (incident
 * 2026-06-11). The decision no longer reads the phone field at all; callers pass
 * the RPC boolean (fetchNeedsPhoneMigration), which is `false` on any failure.
 */
export function authedDest(args: {
  onboarding_status: string | null | undefined;
  referral_source: string | null | undefined;
  needs_phone_migration: boolean | null | undefined;
}): string {
  const { onboarding_status, referral_source, needs_phone_migration } = args;
  if (PHONE_AUTH_ENABLED && needs_phone_migration === true) {
    return '/migration-gate';
  }
  return onboardingDest(onboarding_status, referral_source);
}
