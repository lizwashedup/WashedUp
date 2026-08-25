# Uncommitted work inventory

Captured 2026-08-24. This is an ownership and verification map, not a commit or release recommendation.

## Current repository state

- Native `main` matches `origin/main`. No local commit is waiting to push.
- Native worktree: 17 tracked modified paths, 9 tracked deleted paths, and 43 untracked files.
- Web `main` matches `origin/main`. Its worktree has 2 tracked modified paths and no untracked files.
- Nothing is staged in either repository.
- The latest complete local assertion loop passed. Exact proof is below.

All dirty changes belong to prior user and agent work. Do not reset, stash, clean, overwrite, or collapse them into one release.

## Review batches

### A. Web-preview compatibility

Native paths:

- `app.json`
- `app/_layout.tsx`
- `components/chat/MediaPanel.tsx`
- `components/creator/EventLocationMap.tsx`
- `hooks/usePushNotifications.ts`
- `components/chat/GiphyGrid.ts`
- `components/chat/GiphyGrid.web.ts`
- `lib/giphyInit.ts`
- `lib/giphyInit.web.ts`
- `lib/oneSignalShim.ts`
- `lib/oneSignalShim.web.ts`

Purpose: isolate native-only Giphy and OneSignal code from web bundling.

Local automated proof: native and web typechecks and tests pass. Fresh Expo web and native iOS exports also pass in the final full loop.

Still unverified:

1. GIF search, selection, and send on a real native session.
2. Native notification registration and receipt on a real device.
3. Confirmation that production native notification initialization is unchanged.

### B. Event-room album

Paths:

- `app/event-album/[topicId].tsx`
- `lib/communityChat.ts`
- `lib/topicAlbum.ts`
- `lib/__tests__/communityChatExpiry.test.ts`
- `lib/__tests__/topicAlbum.test.ts`
- `supabase/migrations/20260818170000_event_chat_topic_albums.sql`

Shared technical dependency reviewed under batch D: `supabase/migrations/20260824211000_harden_topic_album_upload_metadata.sql`.

The local work adds creator enablement, final-24-hour notice, closed-room read-only behavior, and upload hard stops. Tests cover expiry calculation, archive denial, membership denial, creator enablement, and upload boundaries.

The migration file already existed and is now modified. Treat it as migration-history-sensitive until its live fingerprint, local fingerprint, apply evidence, and migration-ledger treatment are reconciled.

Still unverified:

1. Authenticated creator enablement on a real Community event.
2. Joined-member upload and read.
3. Nonmember denial.
4. Final-24-hour notice using a real event end time.
5. Upload denial after archive while historical media remains readable.
6. Liz's retention-policy decision and visible-copy approval.
7. Visual review on supported native sizes.

### C. Who's Going

Paths:

- `app/plan/[id].tsx`
- `supabase/migrations/20260824200000_get_event_members_public_reveal_for_nonmembers.sql`
- Web sibling: `src/app/app/plan/[id]/page.tsx`

Shared technical dependency reviewed under batch D: `supabase/migrations/20260824210000_secure_event_members_public_visibility.sql`.

The later local forward migration closes the earlier RPC's anonymous and hidden-event exposure. The client restoration is intended for authenticated viewers only and preserves the older membership-gated RPC as the first path.

Still unverified:

1. Joined member, authenticated nonmember, and creator on native and web.
2. Signed-out denial.
3. Hidden Circle Plan denial.
4. Blocked creator and blocked attendee filtering.
5. Empty and populated attendance.
6. Visual parity with Liz's supplied regression screenshots.
7. Fresh live function fingerprint before any migration promotion.

The older live `get_event_members_reveal()` RPC must remain until a replacement client is actually released.

### D. Local forward-only release-blocker corrections

Paths:

- `supabase/migrations/20260824210000_secure_event_members_public_visibility.sql`
- `supabase/migrations/20260824211000_harden_topic_album_upload_metadata.sql`
- `supabase/migrations/20260824212000_fix_event_members_identity_marks_trigger_safe.sql`

These locally fix the public member-list visibility gap, validate album Storage metadata and MIME limits, and replace an unsafe migration-time identity-marks test with catalog-only verification. The superseded identity-marks draft is preserved under `docs/database/superseded-migrations/`.

The static gate and isolated release-blocker contracts pass. None of these files has been applied to production or proven against fresh live fingerprints.

### E. Reported live database provenance artifacts

Paths:

- `supabase/migrations/20260824180000_fix_dm_circle_plan_stranger_cap.sql`
- `supabase/migrations/20260824200000_get_event_members_public_reveal_for_nonmembers.sql`
- Modified `supabase/migrations/20260818170000_event_chat_topic_albums.sql`

These files report or imply earlier live changes. A repository claim is not enough to prove production state. Do not casually rewrite them or present them as release-ready.

Still unverified:

1. Fresh read-only production fingerprints for every affected function, policy, trigger, table, and grant.
2. Apply evidence and migration-ledger disposition for each version.
3. Exact equality between approved local bodies and observed live bodies.
4. Forward-only treatment for any difference.

### F. Legacy surface removal

Paths:

- `app/(tabs)/friends/index.tsx`
- `app/(tabs)/post/index.tsx`
- Deleted `components/yours/legacy/LegacyYourPeopleScreen.tsx`
- Deleted `components/post/LegacyComposer.tsx`

The two deletions remove more than 4,500 lines and affect user-facing navigation. Liz's conditional approval to archive Friends and Pinned data applies only after Your People is verified end to end. It does not automatically approve these client deletions for release.

Still unverified:

1. Yours navigation and profile access.
2. Every People state and post-Plan discovery/add flow.
3. Shared Plan counts.
4. Post entry, draft restoration, and successful submission.
5. Deep links and empty states.
6. A practical rollback path.
7. Liz's visual and product signoff.

The legacy rollback path remains unprepared and unverified. That blocks any release recommendation even if the automated suite stays green.

### G. Scene discovery web change

Web sibling path:

- `src/components/communities/SceneDiscovery.tsx`

Keep this separate from Who's Going. It is Community-facing.

Still unverified:

1. Real Community and Organization data states.
2. Join versus Follow grammar on every rendered state.
3. Responsive and visual review.
4. Liz's signoff before release.

### H. Database review and hardening package

Review-only SQL and notes:

- `docs/database/live-function-correctness-audit-20260824.md`
- `docs/database/review-only/circle-suggestions-v2.sql`
- `docs/database/review-only/community-join-policy-existing-text.sql`
- `docs/database/review-only/technical-database-hardening.sql`
- `docs/database/review-only/technical-database-hardening-notes.md`
- `docs/database/review-only/technical-moderation-alternative.sql`

Contracts and harness:

- `supabase/tests/contracts/80_circle_suggestions_fixture.sql`
- `supabase/tests/contracts/81_circle_suggestions_contract.sql`
- `supabase/tests/contracts/90_community_join_policy_fixture.sql`
- `supabase/tests/contracts/91_community_join_policy_contract.sql`
- `supabase/tests/contracts/100_technical_database_hardening_fixture.sql`
- `supabase/tests/contracts/101_technical_database_hardening_contract.sql`
- `supabase/tests/contracts/110_release_blockers_fixture.sql`
- `supabase/tests/contracts/111_release_blockers_contract.sql`
- `scripts/db-contracts/migration-contracts.json`
- `scripts/db-contracts/run-private-sql-contracts.sh`
- `docs/database/migration-provenance.json`

Archived inventory:

- `docs/database/superseded-migrations/README.md`
- Preserved superseded notification, Community enum-chain, and Circle scheduling drafts in that directory.

The normal migration runner cannot apply anything under `docs/database/review-only` or `docs/database/superseded-migrations`. Private contracts use an isolated, network-disabled PostgreSQL container.

The default hardening package adds local proposals and contracts for payout replay and allocation provenance, durable blocked-payout records, refund history, attendee-index bounds, question-cap serialization, identifier normalization, photo-hash validation, and service-only ACLs. The separate moderation-alternative SQL preserves distinct-reporter safeguards, session revocation, and durable moderation failures, but it is contingent design work, excluded from the default private gate. Neither package invents alert recipients, private-message retention, a new moderation threshold, or a stricter photo-match policy.

Still unverified or blocked:

1. Canonical checked-in baselines for 24 ticketing and payout functions and 8 admin or restriction functions.
2. Fresh live table constraints, ACLs, RLS, function bodies, and migration ledger immediately before any promotion.
3. Liz's policy for five existing Communities.
4. Liz's moderation and private-message retention choices if a human-review alternative is pursued.
5. Approved routing for payout and refund alerts.
6. Proven lifecycle for the legacy secret-shaped migration exception without exposing a value.
7. A separately reviewed forward migration and rollback plan for any approved subset.

No SQL in this batch is production-ready or authorized for application.

### I. Handoff, source reconciliation, and saved assertions

Paths:

- `CODEX_HANDOFF.md`
- `docs/liz/2026-08-24-approval-pack.md`
- `docs/liz/2026-08-24-source-index-corrections.md`
- `qa/guinea-verify-washedup.sh`
- `handoffs/washedup-pre-compaction-recovery-20260824-*.md`

The handoff now treats Josh's 39-page package as foundational, applies later direct Liz answers only to conflicts, and points to the parent source inventory. The approval pack separates true unanswered decisions from evidence and signoff work.

The recovery handoffs are mechanical continuity records, not product authority and not proof of completion.

## Fresh deterministic baseline

The latest completed full local loop passed:

- Native TypeScript.
- Native Jest: 46 of 46 suites, 402 of 402 tests.
- Focused Deno checks: 94 pass, zero fail.
- Database static migration contracts.
- Database private behavioral contracts, including Circle, Community, and technical hardening cases.
- Fresh Expo web and native iOS exports.
- Web TypeScript.
- Web Vitest without cache: 22 of 22 files, 196 of 196 tests.
- Native and web `git diff --check`.

Re-run `sh qa/guinea-verify-washedup.sh` after every further edit. Passing automation does not prove authenticated click-through, live database compatibility, visual correctness, device behavior, or release safety.

## Protected boundaries

- No commit, push, deploy, build submission, OTA, feature activation, migration apply, cron change, credential change, or production mutation is authorized by this inventory.
- The notification-token finish-versus-revert decision remains unresolved and outside this batch.
- Nothing from this local orchestration was committed, pushed, deployed, applied to production, or sent to Liz.
