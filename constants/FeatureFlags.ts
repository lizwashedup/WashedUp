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
export const PHONE_AUTH_ENABLED = false;

/**
 * Hard cutoff for the migration gate's "i'll do this later" option.
 * Before this date the gate is dismissable; on/after this date the skip
 * button is hidden and adding a phone becomes mandatory to enter the app.
 *
 * Compared as ISO date strings against (new Date()).toISOString().slice(0, 10).
 */
export const PHONE_MIGRATION_MANDATORY_AFTER = '2026-06-01';
