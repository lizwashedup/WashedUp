/**
 * WashedUp — Feature Flags
 *
 * Each flag is a single boolean (or scalar) that can be flipped manually
 * before a build. Default values are the safe / current-prod behavior.
 */

/**
 * Phone-number auth flow.
 *
 * LAUNCH: committed ON. Hardcoded `true` below, with no env override
 * (unlike the flags after this one): flipping it back off means editing
 * this file, not setting a var.
 *
 * Unauthenticated users land on the phone-entry screen, and signed-in users
 * with onboarding_status='complete' but no phone on file are routed through
 * the migration gate. The pre-phone-auth screen (email/password +
 * Apple/Google, no migration gate) still exists behind this flag's `false`
 * branches (app/(auth)/login.tsx, app/(auth)/signup.tsx, lib/authGate.ts,
 * lib/authRouting.ts) but is unreachable while the value stays `true`.
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
 * This remains opt-in until the Community release gate is cleared. Scene's
 * event discovery shell has its own launch flag below, so shipping the current
 * Scene no longer activates unfinished Community controls.
 *
 * When true: the "run things on washedup" entry appears on the profile
 * screen (creator applications, phase 2). Later phases (community pages,
 * creator mode, discovery) hang off this same flag.
 *
 * The admin review queue (/admin/applications) is not behind this flag; it is
 * gated by isAdmin like the rest of the admin surfaces.
 */
export const COMMUNITIES_ENABLED = process.env.EXPO_PUBLIC_COMMUNITIES_ENABLED === 'true';

/**
 * Scene event discovery shell.
 *
 * LAUNCH: committed ON. Exact lowercase `false` is the emergency rollback.
 * This is intentionally separate from COMMUNITIES_ENABLED: the Scene can show
 * live events without opening Community routes before their database release
 * gate is certified.
 */
const SCENE_DISCOVERY_COMMITTED_DEFAULT = true;
export const SCENE_DISCOVERY_ENABLED =
  process.env.EXPO_PUBLIC_SCENE_DISCOVERY_ENABLED === 'false'
    ? false
    : SCENE_DISCOVERY_COMMITTED_DEFAULT;

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
 * LAUNCH: committed ON (Liz decision #11, 2026-09-03: "agree" to the
 * join-policy model). Exact lowercase `false` is the emergency rollback. The
 * double-gate above (flag AND live column read) means this is safe to flip
 * regardless of whether proposal 91's migration has landed yet -- the toggle
 * still cannot render before the column exists, so nothing is exposed early.
 *
 * Local dev: set EXPO_PUBLIC_JOIN_GATE_ENABLED=false in .env.local
 * (gitignored) to force OFF; unset ships ON.
 */
export const JOIN_GATE_ENABLED = process.env.EXPO_PUBLIC_JOIN_GATE_ENABLED !== 'false';

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
 * LAUNCH: committed ON. Liz approved the final copy and gave the word
 * 2026-09-03 (decision #2: "please go ahead with the proposed copy and
 * enable chat deletion"). Exact lowercase `false` is the emergency rollback.
 *
 * Local dev: set EXPO_PUBLIC_CHAT_DELETE_ENABLED=false in .env.local
 * (gitignored) to force OFF; unset ships ON.
 */
export const CHAT_DELETE_ENABLED = process.env.EXPO_PUBLIC_CHAT_DELETE_ENABLED !== 'false';

/**
 * Co-creator invites (R21, qa/requirements.json: "Co-creators and multiple
 * admins" -- foundation and test only, scopeClass yellow, releaseGate
 * block_b).
 *
 * When false (default): nothing changes anywhere. No "co-creators" entry on
 * the members screen, the /creator/co-creators and /invite/co-creator/[token]
 * routes are unreachable through any in-app affordance (a direct deep link
 * still resolves the route, but the screen itself checks this flag too and
 * renders nothing when it is off).
 *
 * When true: the members screen gets a "co-creators" entry; the primary
 * leader can search an existing profile or invite by email/phone, choose
 * their tier (admin/events/member care/finance) at invite time, and
 * manage/revoke pending invites. Backed
 * by supabase/migrations/20260817180000_community_co_creator_invites.sql
 * (create_/preview_/accept_/revoke_co_creator_invite RPCs) -- do not flip on
 * for a real build until that migration is applied to prod.
 *
 * Local dev: set EXPO_PUBLIC_CO_CREATOR_INVITES_ENABLED=true in .env.local
 * (gitignored). Env-driven and ships OFF wherever the var is unset
 * (CI / prod / EAS), so it cannot ship on by accident.
 */
export const CO_CREATOR_INVITES_ENABLED = process.env.EXPO_PUBLIC_CO_CREATOR_INVITES_ENABLED === 'true';

/**
 * Member invites (Build 35 Screen 56). A different feature from co-creator
 * invites above: this grants plain community membership, not co-creator/admin
 * access, and must stay visibly and functionally separate on the members
 * screen (never reuses the co-creators button or its wiring).
 *
 * When false (default): nothing changes anywhere. No "invite members" entry
 * on the members screen, and the /creator/member-invites and
 * /invite/member/[token] routes are unreachable through any in-app
 * affordance (a direct deep link still resolves the route, but the screen
 * itself checks this flag too and renders nothing when it is off).
 *
 * When true: the members screen gets an "invite members" entry distinct from
 * the co-creators one; any active leader or co_leader of the community can
 * search an existing WashedUp profile, add an optional note, send a bound
 * invite, and manage/revoke pending invites. V1 scope is existing-profile
 * invites only -- phone-contact invites are an explicit open product
 * decision (Screen 56 scope doc §4), not built here. Backed by
 * supabase/migrations/20260901020000_build35_screen56_member_invites.sql
 * (create_/preview_/accept_/revoke_member_invite RPCs, DRAFT -- do not flip
 * on for a real build until that migration is reviewed and applied to prod).
 *
 * Local dev: set EXPO_PUBLIC_MEMBER_INVITES_ENABLED=true in .env.local
 * (gitignored). Env-driven and ships OFF wherever the var is unset
 * (CI / prod / EAS), so it cannot ship on by accident.
 */
export const MEMBER_INVITES_ENABLED = process.env.EXPO_PUBLIC_MEMBER_INVITES_ENABLED === 'true';

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
 * LAUNCH: committed ON. Liz approved the member-pill copy and gave the word
 * 2026-09-03 (decision #2: "...and member status"). Exact lowercase `false`
 * is the emergency rollback. Still inert wherever COMMUNITIES_ENABLED is
 * off (see the `&&` above), so this alone cannot expose anything early.
 *
 * Local dev: set EXPO_PUBLIC_MEMBER_STATE_ENABLED=false in .env.local
 * (gitignored) to force OFF; unset ships ON.
 */
export const MEMBER_STATE_ENABLED = process.env.EXPO_PUBLIC_MEMBER_STATE_ENABLED !== 'false';

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

/**
 * Activity-first plan cards on the main Plans discovery feed.
 *
 * This is a visual experiment only. The default is deliberately OFF so the
 * current creator-first card remains unchanged in production, TestFlight, and
 * CI unless a specific build opts in. The opened plan and every other card
 * surface keep the established creator-first layout.
 */
export const PLAN_CARD_ACTIVITY_FIRST_ENABLED =
  process.env.EXPO_PUBLIC_PLAN_CARD_ACTIVITY_FIRST_ENABLED === 'true';

/**
 * Event summary hub (Build 35 Screen 04): a single per-event landing screen
 * showing title/date/venue/status plus attendee and money snapshots, with
 * navigation into the existing Attendees and Money screens.
 *
 * When false (default): the events list links straight to Tickets/Attendees
 * exactly as shipped today, byte-identical.
 *
 * When true: the events list also offers this hub as the landing point for
 * an event, reusing getOperatorEvent/getEventAttendees/getEventMoneySummary
 * as read-only data sources -- no new tables, no new RPCs. The Messages tab
 * shows as coming soon with a stated reason rather than a working button:
 * there is no send backend for attendee messages anywhere in this codebase
 * yet (native or web), so wiring a button to it would be a fake affordance.
 *
 * Local dev: set EXPO_PUBLIC_EVENT_SUMMARY_ENABLED=true in .env.local
 * (gitignored). Env-driven and ships OFF wherever the var is unset
 * (CI / prod / EAS), so it cannot ship on by accident. Built against
 * today's host_user_id/community_id ownership pair, not the drafted
 * owner_type/owner_id columns (migration 20260901010000, not applied to
 * prod) -- ownership-derived filtering here should get a follow-up pass
 * once that migration lands, but this hub does not need it to be useful.
 */
export const EVENT_SUMMARY_ENABLED = process.env.EXPO_PUBLIC_EVENT_SUMMARY_ENABLED === 'true';

/**
 * Community public page control center (Build 35 Screen 14): status, the
 * shareable washedup.app/c/<handle> link, a discovery toggle, and unpublish
 * -- reached from a new row on the existing "your page" card in
 * app/(creator)/menu.tsx.
 *
 * When false (default): nothing changes anywhere. No "manage your public
 * page" row on the menu screen, and /creator/public-page is unreachable
 * through any in-app affordance (a direct deep link still resolves the
 * route, but the screen itself checks this flag too and renders nothing
 * when it is off).
 *
 * When true: the row appears, and the screen shows status + the shareable
 * link and an unpublish action -- all read/write today's live
 * communities.status/handle, no migration needed. The discovery toggle is
 * gated a SECOND, independent way on top of this flag: it only renders once
 * getCommunityDiscoverable() also succeeds, i.e. once
 * supabase/migrations/20260901030000_build35_screen14_public_page_control.sql
 * (DRAFT, not applied) actually lands -- the same double-gate shape
 * JOIN_GATE_ENABLED uses, so neither this flag nor that migration alone can
 * expose a dead control.
 *
 * LAUNCH: committed ON. Liz approved this 2026-09-03 (decision #5: "the
 * Community tab should become the primary home base for the public creator
 * page, with a clear live-status banner, shareable link, and management
 * entry point"). The status/link/unpublish surface needs no migration, so
 * this is safe to enable on today's schema; the discovery toggle stays
 * inert behind its own separate gate above until its migration lands.
 * Exact lowercase `false` is the emergency rollback.
 *
 * Local dev: set EXPO_PUBLIC_PUBLIC_PAGE_CONTROL_ENABLED=false in .env.local
 * (gitignored) to force OFF; unset ships ON.
 */
export const PUBLIC_PAGE_CONTROL_ENABLED = process.env.EXPO_PUBLIC_PUBLIC_PAGE_CONTROL_ENABLED !== 'false';

/**
 * Gender-restricted communities (Liz 2026-09-01, "Women of WashedUp"): a
 * creator can restrict a new community to one gender at creation. A
 * restricted community and its events are fully invisible to a non-matching
 * viewer, not just join-blocked -- get_discoverable_communities(),
 * communities_select RLS, explore_events' "Anyone can view live explore
 * events" RLS policy, and get_filtered_feed() all filter it out, and a
 * wrong-gender join attempt is rejected server-side in
 * request_to_join_community(). Plans created inside a restricted community
 * auto-inherit its restriction at creation: operator_create_explore_event()
 * takes an added p_gender_rule param and computes the default itself. An
 * inconsistent explicit override (e.g. men_only inside a women-only
 * community) is rejected server-side by that same RPC; only the community's
 * own restriction or 'mixed' (open to everyone, the Q4 override) are ever
 * accepted.
 *
 * There is no UI for the per-plan override: the only screen that creates a
 * community-scoped plan is app/creator/event-form.tsx (Screen 22), which is
 * frozen. The backend param above is ready the moment that screen can be
 * touched; until then every create call omits p_gender_rule and the RPC's
 * own auto-inherit default is all that ever fires.
 *
 * When false (default): setup-community.tsx shows no restriction picker.
 * Every community creates exactly as it does today, open to everyone.
 *
 * When true: the picker (everyone / women only / men only) appears on the
 * create-community screen. createCommunity() only sends the new RPC param
 * when a restriction is actually chosen, so leaving every community open
 * stays byte-identical to today even before the migrations below land. Do
 * not flip on for a real build until ALL THREE of
 * supabase/migrations/20260901080000_gender_restricted_communities.sql,
 * 20260901090000_gender_restricted_communities_plan_feed.sql, and
 * 20260901120000_gender_restricted_communities_scene_visibility.sql (all
 * DRAFT, not applied) are reviewed and applied to prod, in that order --
 * the second closes a Plan-feed leak and the third closes a Scene-tab leak,
 * both real "full invisibility" gaps on top of the first migration's
 * schema/RLS/RPC work. Picking an actual restriction before the first one
 * lands fails the create with a clear error (unknown RPC param), not a
 * silent bad write.
 *
 * Local dev: set EXPO_PUBLIC_GENDER_RESTRICTED_COMMUNITIES_ENABLED=true in
 * .env.local (gitignored). Env-driven and ships OFF wherever the var is
 * unset (CI / prod / EAS), so it cannot ship on by accident.
 */
export const GENDER_RESTRICTED_COMMUNITIES_ENABLED =
  process.env.EXPO_PUBLIC_GENDER_RESTRICTED_COMMUNITIES_ENABLED === 'true';

/**
 * Explicit open-vs-approval-required choice at community creation (Josh
 * 2026-09-02: grandfather the 5 pre-existing communities as open, build the
 * real creator choice going forward). Same self-flipping-safe shape as
 * GENDER_RESTRICTED_COMMUNITIES_ENABLED above: flag off means
 * createCommunity() never sends p_join_policy at all, so every create stays
 * byte-identical to today (defaults to open) even before the migration
 * below lands. Do not flip on for a real build until
 * supabase/migrations/20260902200000_community_join_policy_at_creation.sql
 * (DRAFT, not applied) is reviewed and applied to prod -- picking
 * approval_required before it lands fails the create with a clear error
 * (unknown RPC param), not a silent bad write.
 *
 * Local dev: set EXPO_PUBLIC_COMMUNITY_JOIN_POLICY_AT_CREATION_ENABLED=true
 * in .env.local (gitignored). Env-driven and ships OFF wherever the var is
 * unset (CI / prod / EAS), so it cannot ship on by accident.
 */
export const COMMUNITY_JOIN_POLICY_AT_CREATION_ENABLED =
  process.env.EXPO_PUBLIC_COMMUNITY_JOIN_POLICY_AT_CREATION_ENABLED === 'true';

/**
 * Member removal reason + undo (Liz decision #10, 2026-09-03: "require a
 * recorded reason and allow the leader to undo the removal"). See
 * clients/washed-up/LIZ-OPEN-QUESTIONS.md item 10.
 *
 * When false (default): the members screen behaves exactly as shipped --
 * tapping "remove" shows the existing plain confirm alert and calls
 * removeMember() (no reason recorded, no undo). The removed-members list
 * shows status only, no undo affordance.
 *
 * When true: tapping "remove" opens a reason-required prompt and calls the
 * new remove_community_member RPC instead; a removed (not banned) row in the
 * removed-members list gets an "undo" action calling restore_community_member.
 * Both RPCs are defined in
 * supabase/migrations/20260904000000_community_member_removal_reason_and_restore.sql
 * (DRAFT, not applied) -- do not flip this on for a real build until that
 * migration is reviewed and applied to prod.
 *
 * Local dev: set EXPO_PUBLIC_MEMBER_REMOVAL_REASON_ENABLED=true in
 * .env.local (gitignored). Env-driven and ships OFF wherever the var is
 * unset (CI / prod / EAS), so it cannot ship on by accident.
 */
export const MEMBER_REMOVAL_REASON_ENABLED =
  process.env.EXPO_PUBLIC_MEMBER_REMOVAL_REASON_ENABLED === 'true';

/**
 * Invite audience (Liz decision #6, 2026-09-03, the net-new half -- see
 * clients/washed-up/LIZ-OPEN-QUESTIONS.md item 6 and lib/inviteAudience.ts).
 * Lets a creator invite past attendees, followers, or community members to
 * a NEW event, distinct from "Message attendees" (people already
 * registered for THIS event, which has no send backend anywhere and is
 * out of scope here).
 *
 * When false (default): no new tab appears on the event summary hub; this
 * repo's screens are byte-identical to today.
 *
 * When true: the hub offers a real "invite people" screen with live,
 * real preview counts per audience (read-only queries, no new tables). The
 * screen's Send action stays disabled with a stated reason regardless of
 * this flag -- there is no send backend for this either yet, and the
 * "past attendees" audience specifically has an unresolved legal question
 * (see the long comment at the top of lib/inviteAudience.ts) that this
 * flag does not answer. Flipping this on is safe to review; it does not
 * make anything sendable.
 *
 * Local dev: set EXPO_PUBLIC_INVITE_AUDIENCE_ENABLED=true in .env.local
 * (gitignored). Env-driven and ships OFF wherever the var is unset
 * (CI / prod / EAS), so it cannot ship on by accident.
 */
export const INVITE_AUDIENCE_ENABLED =
  process.env.EXPO_PUBLIC_INVITE_AUDIENCE_ENABLED === 'true';

/**
 * Ticket transfer (Liz decision #15, 2026-09-03: "agree with the proposed
 * transfer model"). See clients/washed-up/LIZ-OPEN-QUESTIONS.md item 15 and
 * lib/ticketTransfer.ts.
 *
 * When false (default): no "transfer this ticket" affordance anywhere in
 * the tickets flow; app/t/[code].tsx and app/tickets/transfer/[positionId].tsx
 * still resolve as routes (a direct deep link is not blocked) but each
 * checks this flag itself and renders a plain "not available" state instead
 * of doing anything, since the backing RPCs do not exist in prod yet and
 * would just fail loudly otherwise.
 *
 * When true: the current holder of a seat can start a transfer from their
 * ticket, share the resulting washedup.app/t/<code> link, and the recipient
 * claims it (answering any required per-attendee questions fresh -- the
 * original attendee's answers are never reused). Backed entirely by
 * supabase/migrations/20260904010000_ticket_transfer_draft.sql (DRAFT, not
 * applied) -- do not flip this on for a real build until that migration is
 * reviewed, applied to prod, AND legal has signed off on re-collecting a
 * waiver/age-gate style question from a transfer recipient (Liz's own
 * condition, not yet met by anything in this codebase).
 *
 * Local dev: set EXPO_PUBLIC_TICKET_TRANSFER_ENABLED=true in .env.local
 * (gitignored). Env-driven and ships OFF wherever the var is unset
 * (CI / prod / EAS), so it cannot ship on by accident.
 */
export const TICKET_TRANSFER_ENABLED =
  process.env.EXPO_PUBLIC_TICKET_TRANSFER_ENABLED === 'true';
