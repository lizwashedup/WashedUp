/**
 * WashedUp — Feature Flags
 *
 * Each flag is a single boolean (or scalar) that can be flipped manually
 * before a build. Default values are the safe / current-prod behavior.
 */

/**
 * Phone-number auth flow.
 *
 * When false (current prod default): unauthenticated users land on the
 * existing email/password + Apple/Google login screen. No migration gate
 * is ever shown.
 *
 * When true: unauthenticated users land on the new phone-entry screen,
 * and signed-in users with onboarding_status='complete' but no phone on
 * file are routed through the migration gate.
 *
 * DO NOT flip to true in a committed file until phone auth is fully
 * tested + Twilio/Supabase phone provider verified live.
 */
export const PHONE_AUTH_ENABLED = true;

/**
 * Yours page rebuild.
 *
 * When false (current prod default): the Yours tab renders the existing
 * "Your People" screen unchanged, backed by the friends / pinned_people
 * system. Tab icon, post-plan survey, and post-create/join flows are all
 * the current shipped behavior.
 *
 * When true: the Yours tab renders the rebuilt experience (mutual people
 * requests, activity-ring grid, ghost-avatar referrals, redesigned survey,
 * ping flow) backed by people_connections / people_pings / referral_invites.
 *
 * Local dev: set EXPO_PUBLIC_YOURS_PAGE_ENABLED=true in .env.local (gitignored)
 * to enable the rebuilt Yours page on your machine. The value below is env-driven
 * and ships OFF wherever the var is unset (CI / prod / EAS), so there is nothing
 * to flip back and it cannot ship on by accident. Do not enable it for a real
 * build until the new system is tested AND the backing migrations
 * (supabase/migrations/20260517*) are applied to prod, including the gated archive
 * of the legacy friends / pinned_people data.
 */
export const YOURS_PAGE_ENABLED = process.env.EXPO_PUBLIC_YOURS_PAGE_ENABLED === 'true';
