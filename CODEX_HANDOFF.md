# WashedUp current handoff

Updated 2026-08-24. This file is a current state pointer, not product authority and not release approval.

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
