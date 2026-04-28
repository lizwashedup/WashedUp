/**
 * Module-level "snooze" flag for the phone migration gate.
 *
 * The migration gate is shown to existing OAuth/email users who don't
 * yet have a phone on file (when PHONE_AUTH_ENABLED is true). Tapping
 * "i'll do this later" should dismiss the gate for the current session
 * but bring it back on the next cold start.
 *
 * We deliberately keep this in module memory (not AsyncStorage) so the
 * flag resets when the JS runtime re-evaluates this file on cold start.
 * No persistence needed.
 */

let snoozedThisSession = false;

export function snoozeMigrationGate(): void {
  snoozedThisSession = true;
}

export function isMigrationGateSnoozed(): boolean {
  return snoozedThisSession;
}
