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
 * Communities & Events (creator platform).
 *
 * When false (current prod default): nothing changes anywhere. No creator
 * application entry on the profile screen, no community surfaces.
 *
 * When true: the "run things on washedup" entry appears on the profile
 * screen (creator applications, phase 2). Later phases (community pages,
 * creator mode, discovery) hang off this same flag.
 *
 * Local dev: set EXPO_PUBLIC_COMMUNITIES_ENABLED=true in .env.local
 * (gitignored). The value is env-driven and ships OFF wherever the var is
 * unset (CI / prod / EAS), so it cannot ship on by accident. The admin
 * review queue (/admin/applications) is NOT behind this flag; it is gated
 * by isAdmin like the rest of the admin surfaces.
 */
export const COMMUNITIES_ENABLED = process.env.EXPO_PUBLIC_COMMUNITIES_ENABLED === 'true';

/**
 * Community join-policy gate (proposal 91): the "who gets in" toggle on the
 * join-gate screen (approval-required vs open).
 *
 * When false (default): the toggle never renders, even after 91's join_policy
 * column lands on prod. The screen behaves exactly as shipped.
 *
 * When true: the toggle renders, but ONLY where the column read also succeeds
 * (getJoinPolicy returns non-null). Both conditions are required, so the flag
 * cannot expose a dead control before the migration, and the migration cannot
 * expose the control before the flag. This mirrors web, which gates its half
 * on the same flag AND read so the two platforms flip in lockstep, not on
 * whichever one happens to see the column first.
 *
 * Local dev: set EXPO_PUBLIC_JOIN_GATE_ENABLED=true in .env.local (gitignored).
 * Env-driven and ships OFF wherever the var is unset (CI / prod / EAS), so it
 * cannot ship on by accident. Do not flip on for a real build until 91 is
 * applied to prod and Liz gives the word.
 */
export const JOIN_GATE_ENABLED = process.env.EXPO_PUBLIC_JOIN_GATE_ENABLED === 'true';

/**
 * Delete a chat from the Chats list (doc 120).
 *
 * When false (default): the chat list behaves exactly as shipped. No
 * long-press affordance on any row.
 *
 * When true: DM rows get a long-press "delete chat" affordance and group
 * circle rows get the same affordance labeled "leave circle". Both call the
 * existing leave_circle RPC (client-only; no new SQL). The chat drops from
 * your list; the other side keeps their copy; messaging again starts a
 * fresh thread.
 *
 * Local dev: set EXPO_PUBLIC_CHAT_DELETE_ENABLED=true in .env.local
 * (gitignored). Env-driven and ships OFF wherever the var is unset
 * (CI / prod / EAS), so it cannot ship on by accident. Do not flip on for
 * a real build until Liz rewrites the placeholder copy and gives the word.
 */
export const CHAT_DELETE_ENABLED = process.env.EXPO_PUBLIC_CHAT_DELETE_ENABLED === 'true';

/**
 * Member state on the event page's put-on-by card (doc 121 T9).
 *
 * When false (default): today's behavior. Joining a community auto-follows
 * (proposal 68's trigger), so an active member always reads as "following"
 * on the follow pill.
 *
 * When true: an active member of the fronting community sees a member pill
 * instead of the follow pill; follow is for non-members only. The member
 * string is a LIZ COPY placeholder, so this stays off until she rewrites it.
 *
 * Local dev: set EXPO_PUBLIC_MEMBER_STATE_ENABLED=true in .env.local
 * (gitignored). Env-driven and ships OFF wherever the var is unset
 * (CI / prod / EAS), so it cannot ship on by accident.
 */
export const MEMBER_STATE_ENABLED = process.env.EXPO_PUBLIC_MEMBER_STATE_ENABLED === 'true';

/**
 * The one chat engine (doc 123).
 *
 * When false (default): every chat surface renders exactly as shipped --
 * the FlatList-based ChatThread for plans/circles/DMs, the standalone
 * community thread/topic screens. Byte-identical to today.
 *
 * When true: migrated surfaces render through the new ChatEngineThread
 * (components/chat-engine/): FlashList v2 list, cursor-paged history
 * (newest page first), batched realtime inserts, cached sender profiles.
 * Surfaces migrate one at a time (DMs/circles first, then plan chats,
 * then community threads/topics); an unmigrated surface ignores the flag.
 *
 * Local dev: set EXPO_PUBLIC_CHAT_ENGINE_ENABLED=true in .env.local
 * (gitignored). Env-driven and ships OFF wherever the var is unset
 * (CI / prod / EAS), so it cannot ship on by accident. Do not flip on for
 * a real build until the doc-123 bar is measured and passed on device.
 */
export const CHAT_ENGINE_ENABLED = process.env.EXPO_PUBLIC_CHAT_ENGINE_ENABLED === 'true';

/**
 * Chat perf HUD for the doc-106 s5 device measurement pass.
 *
 * When false (default): nothing renders, no timing work runs. Ships OFF.
 *
 * When true AND the chat engine is on: engine threads show a small timing
 * pill (cold open -> first layout, -> data ready, last send -> render) so
 * the production-build device pass reads real numbers instead of stopwatch
 * guesses. Dev menus and the RN perf monitor do not exist in production
 * builds; this is the only quantitative window.
 *
 * Local dev / preview: set EXPO_PUBLIC_CHAT_PERF_HUD=true (in .env.local or
 * the EAS PREVIEW environment alongside the engine flag). Env-driven and
 * ships OFF wherever the var is unset, so it cannot ship on by accident.
 * Never set it in the EAS production environment.
 */
export const CHAT_PERF_HUD = process.env.EXPO_PUBLIC_CHAT_PERF_HUD === 'true';
