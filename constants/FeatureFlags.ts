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
