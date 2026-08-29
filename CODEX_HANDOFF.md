# WashedUp current handoff

Updated 2026-08-24, with a 2026-08-29 addition below. This file is a current state pointer, not product authority and not release approval.

## 2026-08-29 addition: community-topic chat parity task

Net-new since the 8/24 sections below; those sections describe separate, still-unresolved work batches and are untouched by this addition. Do not touch Giphy shims, Who's Going, legacy Friends/Post removal, the notification-credential rotation decision, or migration-inventory reconciliation as part of this task — they stay exactly where the sections below leave them.

**Context, briefly:** a real moderation incident (explicit-content plan, Liz asked for takedown+ban) was resolved live on 8/28 via `admin_ban_user`, confirmed with a fresh post-commit query — closed, no action needed here. A new spec one level up, `clients/washed-up/specs/washedup-75-THRESHOLD-SPEC-v1-20260828.md`, documents Liz's own stated priority bar before she emails 75 target community creators: chat/notifications parity is tied for her #1 priority. The event-to-ticket connective-tissue fix (a separate spec item) is DONE — built and verified in this repo already (typecheck clean, 422 tests passing). Do not redo it. Touched files: `lib/organizerHome.ts`, `lib/__tests__/organizerHome.test.ts`, `app/(creator)/events.tsx`, `app/creator/event-form.tsx`, `app/creator/tickets.tsx`. Still needs a human on a real device to visually confirm — that's the only open piece there, not a build task.

**The task: build community-topic chat parity.**

Two architecturally separate surfaces exist and were previously wrongly conflated as one "community chat" — don't conflate them again:
- `app/community-thread/[id].tsx` (main room, renders via `components/communities/BroadcastCard.tsx`) ALREADY has reactions (fixed 3-emoji set, `community_broadcast_reactions`) and replies (`community_broadcast_replies`), deliberately, per a prior product decision named "15a" in BroadcastCard's own header comment. Its remaining real gaps: photo/image messages, @mentions/autocomplete, message edit (own message; delete-own is also currently missing — long-press on your own message is a dead tap), message grouping/date separators, mini-profile-card on avatar tap.
- `app/community-topic/[id].tsx` (per-event/room chat) has NONE of that — confirmed at the schema level, its `TopicMessage` type (`lib/communityChat.ts:465-472`) only carries `id, body, created_at, sender_id, sender_name, sender_photo`. This is the bigger gap: reactions, photos, replies/quote-threading, edit (delete-own already exists), mentions, typing indicators, link preview cards, message grouping/date separators, mini-profile-card, scroll-to-bottom/unread button.

Explicitly OUT of scope, do not build: voice messages, location sharing, presence-based push suppression (all lower priority than Liz's stated "basic" bar; push-suppression is a pre-existing cross-cutting gap on circles too, not unique here).

**Architecture already decided, don't re-litigate:** do NOT merge `community_topic_messages` into the live `messages`/`ChatThread` table-and-component — that table has real, unmigrated history (e.g. one real community with 19 members already chatting) and `ChatThread.tsx`'s `useChat()` call is hard-typed to `'event' | 'circle'`, not a dumb prop-driven component. Instead, extend `community_topic_messages` additively (new nullable `image_url`, `reply_to_message_id`, `edited_at` columns) plus a new sibling `community_topic_message_reactions` table shaped like the existing `message_reactions`, and build a new `useTopicChat` hook that mirrors `useChat`'s proven optimistic-send/realtime/reaction logic but targets the topic tables. A draft migration already exists for this, NOT applied: `supabase/migrations/20260828200000_community_topic_chat_parity_phase1.sql`. Check it, extend it if needed, but do not apply it — Josh runs all live DB changes himself via the Supabase dashboard, never from a credential Codex or Claude holds directly.

**Ordered build plan for community-topic** (do in order, later steps depend on earlier ones):
1. Extend/finalize the migration file (write only, Josh applies it later).
2. Reactions — reuse `useChat`'s `toggleReaction` logic against the new sibling table.
3. Replies — schema's ready (`reply_to_message_id`), needs quote-render UI.
4. Edit own message.
5. Message grouping/date separators, scroll-to-bottom button, mini-profile-card — pure client UI, no backend dependency, bundle cheaply with whichever pass touches the render loop.
6. Photos — check whether plan chat's existing upload/storage helper is reusable before building new upload plumbing.
7. Mentions/autocomplete — member lookup already exists (`community_topic_members`), the @-trigger UI and highlighting is the real work.
8. Typing indicators — check whether `ChatThread`'s presence-channel implementation is already parametrized by conversation id before assuming it needs a rebuild.
9. Link preview cards — check whether `ChatThread`'s unfurl logic is a reusable utility or embedded in the component before sizing this.

Then a shorter list for community-thread (broadcasts): photos, mentions, edit + delete-own, grouping/separators, mini-profile — smaller since reactions/replies already exist there.

**Two real product decisions — surface these to Josh explicitly in your final report, do not assume either answer:**
1. Community-thread's reactions/replies were deliberately kept minimal per "decision 15a." Liz's 8/27 call statement ("people should be able to do everything in that chat that they can do in the other chats") reads as a newer, direct supersede of that decision — but that's a call for Liz/Josh, not an engineering inference.
2. Whether reactions (on either surface) should get a full emoji picker (circle-chat parity) or keep the same fixed 3-emoji set broadcasts already use.

**Hard constraints, same as always for this repo** (see AGENTS.md for full detail): Golden Hour tokens only (Colors.ts/Typography.ts, no hardcoded hex/fonts), "host" and variants forbidden in anything new (UI copy/variables/styles) — existing DB columns like `host_id` stay untouched. Never change existing DB column/RPC names, never remove/alter existing data-fetching logic, additive-only schema changes, never apply SQL directly. **Do not run `git commit`, `git add`, `git push`, or any git write command — local file edits only.** Josh reviews, commits, and pushes himself.

Unrelated, found while reading the review-only folder, no action needed: `docs/database/review-only/circle-suggestions-v2.sql` and `community-join-policy-existing-text.sql` are about circle suggestions and community join-policy — different features, not part of this task, leave them alone.

## Source authority

Josh's 39-page `WashedUp, Package for Josh Freedman` dated 5 August 2026 is the foundational product vision and build-order document. Keep using it for the original Blocks A through F, ownership boundaries, and product intent.

Later direct Liz Q&A, functional specs, and design handoffs refine that foundation. They supersede the 39-page package only where they explicitly conflict or answer a question that was still open in the package. They do not erase the package or replace its unaffected direction.

The complete source inventory is:

`/Users/josh/Desktop/Crucible/clients/washed-up/liz-source-documents/INDEX.md`

Use that inventory before scoping or asking Liz anything. The local correction note at `docs/liz/2026-08-24-source-index-corrections.md` records known stale or ambiguous rows in the index. Current repository evidence decides implementation state, but code does not decide Liz's product policy.

## Non-negotiable boundary

- Liz decides product behavior, visible design, Community behavior, public wording, policy, and release taste.
- Josh and engineering may prepare and test local technical work without inventing those decisions.
- Never commit, push, deploy, submit a build, apply a migration, activate a flag, change a cron, rotate a credential, or mutate production without Josh's fresh explicit approval for that exact action.
- Nothing visual or Community-facing ships without Liz's signoff.
- Preserve the dirty worktree. Do not reset, stash, clean, stage, or absorb unrelated work.

## Current local preparation

The native and web repositories contain uncommitted work in separate review batches:

1. Web-preview compatibility shims for native-only Giphy and notification libraries.
2. Event-room album controls, expiry handling, upload safety, and tests.
3. Native and web Who's Going restoration with authenticated, visibility-aware database support.
4. Legacy Friends and Post surface removal, still isolated because it is user-facing and large.
5. Database migration-inventory reconciliation, review-only Circle and Community proposals, private SQL contracts, and a review-only technical hardening package.
6. A deterministic full-loop script at `qa/guinea-verify-washedup.sh`.

Incompatible and superseded drafts have been preserved outside `supabase/migrations` under `docs/database/superseded-migrations/`. Review-only SQL stays under `docs/database/review-only/`, where the normal migration runner cannot apply it.

## Verification state

The latest completed full local loop on 24 August passed:

- Native TypeScript.
- 46 native Jest suites and 402 tests.
- 94 focused Deno checks.
- Isolated private PostgreSQL contracts, including Circle, Community, and technical hardening cases.
- Fresh Expo web and native iOS exports.
- Web TypeScript.
- 22 web Vitest files and 196 tests.
- Native and web diff checks.

Always rerun `sh qa/guinea-verify-washedup.sh` after any further edit. Passing local automation does not prove live schema compatibility, authenticated device behavior, visual correctness, App Store readiness, or release safety.

## Safe work versus release blockers

Safe local work includes code review, static checks, isolated database contracts, local builds that do not incur cost, documentation reconciliation, and preparation of screenshots or comparison packs.

Release remains blocked on the exact batch-specific gates in `docs/audits/2026-08-24-uncommitted-work-inventory.md`, including:

- Authenticated native and web walkthroughs for album and Who's Going states.
- Device checks for native Giphy and notification initialization.
- End-to-end verification of Yours and Post before legacy removal can be recommended.
- A prepared and verified rollback path for the legacy surface removal.
- Liz approval for visible and Community-facing behavior and copy.
- Canonical migration provenance and fresh live fingerprints before any database promotion.
- Josh's separate approval for every protected action.

The legacy secret-shaped migration exception remains a release blocker until its lifecycle is proven without exposing a value.

The three new local forward migrations `20260824210000`, `20260824211000`, and `20260824212000` pass static and isolated contracts. They remain uncommitted and unapplied. The historical event-album migration fingerprint is still unverified.

## Unresolved notification credential decision

`NOTIFY_REPORT_RUN_TOKEN` and `NOTIFY_PLAN_POSTED_RUN_TOKEN` were rotated on the Supabase Edge Function side, but the matching Vault values were not updated. Finish versus revert is still unresolved.

Do not choose or change either side. Josh must explicitly choose one of these two actions before any credential work:

1. Finish the rotation by updating the matching Vault values.
2. Revert the Edge Function secrets to the prior matching values.

No secret value belongs in a handoff, log, test artifact, or chat.

## Product decisions still needed

Do not send a broad or recycled question list. The current prepared questions and evidence requirements are in `docs/liz/2026-08-24-approval-pack.md`. Engineering should finish every safe local artifact first, then ask only the remaining decision questions supported by that pack.

## Current git and live status

- All work described here is local and uncommitted unless a path's own provenance record says it documents an earlier live change.
- Nothing from this orchestration was committed, pushed, deployed, applied to production, or sent to Liz.
- A passing local test is not permission to release.
