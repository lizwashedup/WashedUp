# Circle-aware plans — build notes & assumptions (autonomous overnight build, 2026-06-09)

Branch: `feature/yours-page-rebuild`. All gated behind `GROUPS_ENABLED` / `YOURS_PAGE_ENABLED` (OFF in prod). Migrations are **held** (review-only, not applied). Plan: `~/.claude/plans/curried-crafting-glade.md`.

## Verified prod facts (read-only grounding, project upstjumasqblszevlgik)
- Circles DB layer is **already LIVE on prod**: tables `circles`, `circle_members`, `circle_suggestions`, `circle_briefs`, `circle_listener_state`; RPCs `create_circle`, `get_circle`, `get_my_circles`, `get_or_create_dm`, `is_circle_member`, `is_circle_admin`, `join_circle_atomic`, `leave_circle`, `invite_to_circle`, `update_circle`; `messages.circle_id` + `chat_reads`/`event_id` polymorphic. Only the gated client + these 4 new migrations are outstanding.
- `post_circle_system_message` / `circle_display_name` are **NOT** on prod (that migration is unapplied) → `create_circle_plan` inlines its `messages` inserts.
- `events.host_message` CHECK is `NULL OR char_length <= 150` (no 10-char minimum). `max_invites` CHECK: `NULL OR (non-featured 1..15) OR (featured 1..999)`.
- `sync_event_member_count` flips `status='full'` when `guest_count >= COALESCE(max_invites,7)` (guests = joined non-creator) and back below.
- `join_event_atomic`: full when `count(joined, all roles) > COALESCE(max_invites,7)`. Server is greeting-agnostic (intro gate is client-side).
- `get_filtered_feed` is the 4-arg prod CTE rebuild; `spots_remaining = max_invites + 1 - member_count`; includes `status IN (forming,active,full)`; excludes already-joined `role='guest'`.
- `events` INSERT fires `notify_plan_posted` → `notify-plan-posted` edge fn which is **internal-only** (emails liz@washedup.app + pushes admins, `type='admin_plan_alert'`). NOT public/user-facing. `event_members` INSERT fires `notify_member_joined` (writes `app_notifications`; no-op at creation since it excludes the joiner).

## Assumptions made (pick-most-consistent-with-spec, per overnight rules)
- **A1.** Member opt-in: only the **creator** is auto-added for whole-circle and open plans; other circle members join individually via the card and bypass the intro gate. Matches "Join if you're around" + "5 of 6 in".
- **A2.** Picked subset (just-us): creator **+ the picked members** are auto-added as joined. Picking specific people = inviting them; mirrors the DM auto-add rule. They populate the spawned subset chat.
- **A3.** DM (2-person circle), whole audience: auto-add the other member (spec: "the other person is automatically added"). Detected by circle having exactly 2 joined members.
- **A4.** `max_invites = 15` sentinel on circle plans (non-featured max). Cosmetic `status='full'` only at 16+ total attendees (rare); join always routes through `join_circle_plan_atomic`/`stranger_cap`, and the feed includes `full`, so this is display-only.
- **A5.** Circle-chat announcement (system message) is posted for **circle_only-whole** and **open** plans; subset plans are NOT announced to the whole circle (private). Plans with their own chat (open / subset) get an opening event-chat system message.
- **A6.** Subset privacy in the noticeboard: subset plans are scoped to participants via `event_members`; whole-circle & open plans show to all members.
- **A7.** `notify-plan-posted` left untouched (internal admin alert only). Optional future edge-fn guard to skip circle plans — NOT done (would touch push-adjacent code; needs explicit approval).
- **A8.** Release ("Open it up") lives on the plan detail card (per your answer); it flips `circle_visibility` to 'open', sets `stranger_cap`, and spawns the chat.

## Blockers / for-review
- Sentry REACT-NATIVE-Z: code already fixed at HEAD `9fb8693` (no code change needed). Resolving the Sentry issue needs you to run `/mcp` → authenticate "claude.ai Sentry"; I cannot resolve it without that. (Or resolve manually in the Sentry UI.)
- Local self-test: see end of file for whether a local Supabase stack was available.

## Build log
(updated as parts land)
