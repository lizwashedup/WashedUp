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
// LAUNCH: committed ON. The env var is now an emergency-rollback override only.
// Set EXPO_PUBLIC_YOURS_PAGE_ENABLED=false to force OFF; unset ships ON.
export const YOURS_PAGE_ENABLED = process.env.EXPO_PUBLIC_YOURS_PAGE_ENABLED !== 'false';

/**
 * Circles (people + circles).
 *
 * GROUPS_ENABLED is the legacy flag name for the Circles feature. It is kept
 * for consistency with existing references. "Circles" is the user-facing term.
 *
 * When false (current prod default): nothing changes. No Circles surfaces are
 * rendered anywhere, and the Yours tab, chat, and plan flows behave exactly as
 * shipped.
 *
 * When true: the Circles surfaces (directory in Yours, circle noticeboard,
 * circle chat, The Room) render, backed by the circles / circle_members tables
 * and the polymorphic circle_id chat path.
 *
 * Local dev: set EXPO_PUBLIC_GROUPS_ENABLED=true in .env.local (gitignored) to
 * enable Circles on your machine. The value below is env-driven and ships OFF
 * wherever the var is unset (CI / prod / EAS), so there is nothing to flip back
 * and it cannot ship on by accident. Do not enable it for a real build until
 * Circles is tested AND the backing migrations (supabase/migrations/20260530*)
 * are applied to prod.
 */
// LAUNCH: committed ON. Emergency-rollback override only. Set
// EXPO_PUBLIC_GROUPS_ENABLED=false to force OFF; unset ships ON.
export const GROUPS_ENABLED = process.env.EXPO_PUBLIC_GROUPS_ENABLED !== 'false';

/**
 * Phone-canonical account reconciliation (prevents phone-vs-Apple duplicate
 * accounts).
 *
 * When false (current prod default): the migration gate dead-ends with
 * "that number is linked to another account" if the phone is already taken.
 *
 * When true: at the migration gate, if the entered phone already belongs to
 * a DIFFERENT account, we sign the user into THAT account (their real one)
 * via a fresh sign-in OTP instead of dead-ending, so an Apple signup that
 * collides with an existing phone account resolves to one account, not two.
 *
 * FLAG SAFETY: the committed default is authoritative. The env var is an
 * ADDITIVE local-test override only; when UNSET it resolves to the committed
 * default, so an EAS build with no env var ships the committed value and can
 * never silently ship OFF. Flip the committed default to true only after the
 * session swap (sign out shell, verify SMS, land on the canonical account) is
 * device-tested.
 */
// LAUNCH: committed ON (default authoritative; env unset ships this value).
const PHONE_CANONICAL_COMMITTED_DEFAULT = true;
export const PHONE_CANONICAL_ENABLED =
  process.env.EXPO_PUBLIC_PHONE_CANONICAL_ENABLED === 'true'
    ? true
    : process.env.EXPO_PUBLIC_PHONE_CANONICAL_ENABLED === 'false'
      ? false
      : PHONE_CANONICAL_COMMITTED_DEFAULT;

/**
 * Post-join "re-enable notifications" soft-prompt (lever #1 of the push
 * reachability work). When a user joins a plan but has notifications disabled
 * at the OS level, a soft modal asks them to turn them back on (deep-linking to
 * Settings for hard-denied users, since the native dialog no-ops there).
 *
 * Ships OFF (committed default false). Uses the additive-override idiom: an
 * EAS build with the env var unset ships the committed default and can never
 * silently ship ON. Flip the committed default to true only after real-device
 * testing on iOS + Android and Liz's go-ahead.
 */
const NOTIF_REENABLE_COMMITTED_DEFAULT = false;
export const NOTIF_REENABLE_PROMPT_ENABLED =
  process.env.EXPO_PUBLIC_NOTIF_REENABLE_PROMPT_ENABLED === 'true'
    ? true
    : process.env.EXPO_PUBLIC_NOTIF_REENABLE_PROMPT_ENABLED === 'false'
      ? false
      : NOTIF_REENABLE_COMMITTED_DEFAULT;
