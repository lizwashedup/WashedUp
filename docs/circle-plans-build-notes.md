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

## Verification results
- **tsc**: `npx tsc --noEmit` clean (0 errors) after every part.
- **Forbidden-word + dash lint**: all new user-facing strings clean (no crew/friend/friendship/group/regulars/host; no em/en dashes). The only "host" usages are DB column/role names (host_message, role 'host'), which must not change.
- **Migration self-tests**: NOT run. The sim/dev `.env.local` points at PROD (upstjumasqblszevlgik) and the rule is no prod apply / no prod run; no local Supabase stack was stood up (repointing env or applying to prod was out of bounds). The 4 migrations carry in-transaction smoke-call self-tests that will run on apply. **This is the checkpoint: run them on a clone/local, or approve the prod apply, before flip.**
- **Live sim screenshots** (iPhone 17 Pro Max, idb, against prod with GROUPS_ENABLED=true), in `docs/circle-plans-shots/`:
  - `01-circles-tab` directory, `02-circle-chat`, `03-plus-menu` ("Make a plan" now wired, no longer "Coming soon"),
  - `04-composer-justus` (Just us selected, Everyone/Pick people chips + helper),
  - `05-composer-open` (Open it up + the 2-7 stepper at 4, "On top of {circle}, up to 7 from the feed."). Post button correctly disabled with no title.
  - The composer is client-only so it renders against prod without the migrations. **Data-dependent states (posted card badge/tag, Start-a-chat / Open-it-up rows, noticeboard plan rows, member intro-bypass join) could NOT be screenshotted**: they require the held migrations live on the sim's DB (= prod), which the no-prod rule forbids. They are covered by code review + the migration self-tests instead, and should be shot after the migrations are applied on a clone/local.

## Build log (commits on feature/yours-page-rebuild)
1. `f79cd7e` 4 held backend migrations (review-only) + build notes.
2. `5e18500` Make-a-plan composer + create flow + hooks + COPY + tokens + trigger wiring.
3. `1bb7424` posted plan card circle states (badge / tag / join line), gated feed enrichment.
4. `0105cbf` plan-detail join dispatch + member intro-bypass + Start-a-chat / Open-it-up; added release_circle_plan + circle_name to held migration 2.
5. `d957a46` circle plans in the noticeboard coming-up slot.

## Two audit passes (full results in the morning report)
Ran two independent reviewers over `9fb8693..HEAD`. **Fixed** (commit 769be0a):
- plan-detail capacity/eligibility gates blocked circle members from joining their own circle's plan (isFull clamps to MAX_GROUP=8; isEligible blocks single-gender) -> added effectiveIsFull/effectiveIsEligible.
- create_circle_plan: gender_rule text->enum needed an explicit `::gender_rule` cast (would have failed on apply).
- create_circle_plan self-test: suppress AFTER triggers so the smoke INSERTs can't enqueue the notify-plan-posted admin alert.
- join_circle_plan_atomic: preserve creator 'host' role on re-join.
- useCirclePlanContext: degrade on PGRST202/404, not just 42883 (flag-on-before-migration safety).
- BottomSheet/composer: bound the ScrollView so it scrolls on small screens.
- Android '+' menu title was mislabeled 'Add people'.

**Reviewed and accepted / deferred (not bugs or low-risk):** feed `is_circle_member` per-row cost once circle plans exist (perf follow-up); release posts no circle-chat announcement (product choice); stranger hitting a circle_only deep link gets a soft "just for the circle" error (edge); two BrandedAlerts can't actually stack (close-after-press ordering); buildDays "Today" stale past midnight is caught by the future-time guard; a deleted circle turns its plan into a normal public plan (SET NULL by design). A few dead COPY keys left in place for later wiring (gender pill, open status).

## Deferred (logged, NOT done) — secondary surfacing, feature is functionally complete without them
- **Chats-list "private to circle" tag**: the Chats list row source (app/(tabs)/chats/index.tsx + its chats hook) does not carry `circle_visibility`; threading it through is a deeper change. The tag already appears on the PlanCard and in the circle noticeboard, so the concept is surfaced. Deferred.
- **Directory upcoming-plan pill / "plans together" count** on the Yours > Circles cards: `get_my_circles` returns no plan data; needs a batch per-circle plan query. Deferred.
- **Single-gender circle plans in the composer**: composer leaves gender = mixed ("inherited, not set here"); backend + feed fully support single-gender if `gender_rule` is set later.
- **Sentry REACT-NATIVE-Z**: already code-fixed at HEAD; needs you to authenticate Sentry MCP (`/mcp`) or resolve in the UI.
