<!-- Handoff v2, see ~/.claude/templates/handoff-template.md -->

## CANONICAL PRODUCT SOURCE, verified 2026-08-17

The product and build-order source of truth is the complete 39-page PDF:

`/Users/josh/Downloads/WashedUp_Package_Josh_Freedman.pdf`

- Title: `WashedUp, Package for Josh Freedman`
- Date: 5 August 2026
- Pages: 39
- SHA-256: `18fd8930e08265650161ba9bdf279367defaeed3634f54f327f23744d75f0260`
- Codex read all 39 pages directly on 2026-08-17 and visually checked the Block A/B and Part 11 pages.

Do not substitute `qa/requirements.json`, an old draft, a memory summary, or this handoff for the PDF. Those are indexes and state snapshots only. Re-open the PDF whenever scoping or reconciling a Liz question.

### What the PDF assigns

- Liz owns product direction, the detailed Scene scope, design, creator conversations, legal, and the product decisions listed in Part 11.
- Josh/Codex owns backend and architecture decisions, how the blocks are built, and the money/user-safety quality bar.
- The six architectural questions in Part 11 are questions for Josh/Codex to answer, not questions to send back to Liz.
- The PDF says basic Circles was already live on 5 August. Its stated problem is awareness and unmeasured usage, not whether Circles exists.

### Reconciled Liz asks, after checking the PDF, screenshots, code, and git history

1. Send the detailed Scene scope that Part 10 says Liz will write and hand over, and which she later said she was targeting for Monday.
2. Walk through the current Block A ticketing outstanding list that Parts 2, 4, and 10 say Liz maintains and will take Josh through.
3. Approve or rewrite the exact delete-chat copy and approve it for a review build. This code landed after the PDF, on 6 August, explicitly marked as Liz-copy placeholder and flag-off.
4. Approve the active-member pill label (`Member`) and approve it for a review build. This also landed after the PDF, on 6 August, explicitly marked as Liz-copy placeholder and flag-off.
5. Decide whether to approve the tested archive of legacy `friends` and `pinned_people` data, preserving it read-only for rollback, or leave it untouched. The PDF does not answer this data-retention decision.
6. Decide the account-deletion policy when an organizer is still owed a payout: block deletion until paid, or permit deletion while retaining the minimum financial record required to complete payment. Do not present forfeiture as the default alternative. This gap was found after the PDF.

Do not ask Liz again about plan-card attendee display, Girls Trips tracking, where the money code lives, whether Communities is live, or build-number auto-increment. Those are already answered. Check App Store Connect before asking her anything about TestFlight access. Do not send a vague `Circles call` question without a specific behavior or decision to review.

## CRITICAL UPDATE, read this first (2026-08-16, added after this file was first written)

A background job from later that same night tried to publish a production OTA update for both platforms. Its own completion notice claimed success (exit 0). That claim was checked against the real log and is WRONG: it actually failed, exit code 1, a bundling error in a chat GIF component (Giphy SDK) when building for web. Nothing reached Expo's servers. No real user got a different app than before. Do not trust a background task's own success/fail label without checking the real output.

Separately, a large batch of new, uncommitted work is sitting in this repo: Communities screens, ticket wallet delivery, discovery/intelligence libraries, 5 new database migrations dated 20260816, new test suites. This looks like it landed from an overnight build. None of it is committed. None of it is live. It needs a real review before anything in it ships, and the web-bundle break needs fixing before any future OTA attempt for "both platforms" is tried again (this repo's own scripts/publish-ota.sh and scripts/ota-guard.sh exist specifically to prevent this class of mistake, publish one platform at a time, not "all").

Everything below this point is the original handoff from earlier that night and is still accurate for what it covers.

---

# crucible: WashedUp 2 fixes committed, real hook bug fixed, secret rotation left half-done, ~15-20% of 40-page plan (2026-08-15 21:03)

**Terminal tag:** crucible-T4980

**TLDR:** Two security fixes from earlier tonight are now live on the database AND committed to git (68d1c0f), not pushed. Found and fixed a real bug in commit-scope-guard.py (was wrongly blocking multi-line commit messages), verified with real tests. Mid-rotation on 2 notification tokens, Josh said stop before the database side was updated to match the edge-function side, this is UNRESOLVED and needs to be closed one way or the other before anything else touches it. Against Liz's 40-page plan, real progress is roughly 15-20 percent: Block A done, Block B has unwired code but nothing live, Blocks C-F not started.

**Status:** in-progress, one CRITICAL open item
**Supersedes:** crucible-T4980-washedup-two-security-fixes-live-ios-sim-running-6decisions-pending-20260815-0136.md
**Parent record:** `~/.claude/projects/-Users-josh-Desktop-Crucible-clients-washed-up-repos-WashedUp/memory/project_washedup-status-20260815-rotation-halfdone-40pagedoc-progress.md` (full detail, read this first on resume)

## Decisions

- Task #67 (3/4 tables) and #61 Stage 1 (token-to-vault move): both applied live, both independently reverified, both committed as of tonight (commit `68d1c0f`). Not pushed to origin. [PROVEN: git log, live DB queries, this session]
- `organizer_receivables` deliberately excluded from the FK fix: it's a money ledger, the correct FK behavior is a product call for Liz, not a cleanup. Routed to her, not decided here. [PROVEN: Josh's direct correction, this session]
- Found and fixed a real bug in `~/.claude/hooks/commit-scope-guard.py`: it splits commands on every newline to find `git commit` calls, but wasn't quote/heredoc-aware, so a commit message built via `-m "$(cat <<'EOF' ... EOF)"` got shredded into fake fragments and the real `-- <pathspec>` became invisible, making a correctly-scoped commit look pathspec-less and get wrongly blocked. Fixed by routing the command text through the same `unquoted_spans()` helper `commit-push-guard.py` already uses. Verified 4 ways: syntax check, the exact failing case now allows, a genuinely unscoped commit still blocks, the `-a` flag still blocks, the `ALLOW-FULL-COMMIT` override still works. [PROVEN: 4 real test runs with recorded exit codes, this session]
- **CRITICAL, NOT resolved:** Josh said "deploy" for the token-rotation Stage 2 cutover. Ran `supabase secrets set` on `NOTIFY_REPORT_RUN_TOKEN` and `NOTIFY_PLAN_POSTED_RUN_TOKEN` (both edge-function secrets) to fresh random values. Josh then said stop, mid-sequence, before the matching Postgres Vault secrets (`notify_report_run_token`, `notify_plan_posted_run_token`) were updated to match. As of now, the edge functions and the database trigger may be sending different token values to each other. Real blast radius is small: only 2 internal alert emails (abuse-report flags, new-plan-posted notices), both fail silently on mismatch (existing `EXCEPTION WHEN OTHERS`), nothing user-facing, no auth/payment/data risk. But it is a live inconsistency sitting open right now. [PROVEN: `supabase secrets set` real exit code 0, this session; NOT YET re-verified whether vault still holds the old value]
- A `supabase secrets list` call printed what looked like every secret in the project (Stripe keys, service role key, etc). Verified this was NOT a real leak: none of the printed values match their real format (no `sk_live_`/`sk_test_` prefix on the Stripe entries, no `eyJ` JWT shape on the service role key), consistent with Supabase's own digest/hash display, not real values. [PROVEN: format-mismatch check against known real secret shapes, this session]
- 40-page doc completion, fresh this session: Block A (money loop) done, committed. Block B (Scene/Communities): real screen code exists (community detail/thread, creator setup/apply, touched 8/13) but wired into nothing, no real user can reach it, blocked on Liz's scope doc (task #27, "targeting Monday" as of 8/13). Blocks C/D/E/F: not started, each gated behind B. User count fresh-checked: 4,025 of her 10,000 target (separate axis from build completion, don't conflate). [PROVEN: git log, file/nav grep, live DB count, this session]

## State

- WashedUp repo: clean except `AGENTS.md` (unexplained, still unflagged, not investigated) and `supabase/.temp/linked-project.json` (harmless CLI artifact). 3 commits ahead of origin, none pushed. [PROVEN: `git status`/`git log`, this session]
- The Liz-facing message + TestFlight instructions file exists (`clients/washed-up/liz-outstanding-and-testflight-20260815.md`), opened for Josh, NOT sent to Liz yet. Real, verified-unanswered items in it: circles feature call, 3 copy-blocked flags, legacy archive migration go-ahead, eas.json autoIncrement question, the new organizer_receivables policy question, and a new TestFlight-access question. Two previously-uncertain items (plan cards, Girls Trips tracking) were confirmed ALREADY answered by Liz on 8/13 and correctly excluded. [PROVEN: nexus-mem cross-check, this session]
- TestFlight: not started. Needs a fresh paid EAS build (last real build was 6/16-6/23, predates this whole week), Josh's cost approval, then submit, then confirming Liz has App Store Connect tester access (unknown, can't check from here).
- Two MCP sessions dead all evening: Vercel (blocks checking command-center-next's real status) and Gmail (blocks checking for any of Liz's replies by email). Neither retried since expiring; need a fresh login before either can be checked again.
- iOS simulator + Metro from earlier tonight (`npx expo start --port 8081`, pid ~3364/3208): confirmed STILL RUNNING as of this session's later hours, but nobody re-confirmed whether the real app UI ever finished loading in it. Cold thread, not touched again after the initial build.
- New memory file this session: `project_washedup-status-20260815-rotation-halfdone-40pagedoc-progress.md`, indexed in this repo's MEMORY.md under a new Project section.

## Next: durable

- **Close the rotation, first thing, before anything else touches these 2 functions:** either finish it (update `notify_report_run_token` and `notify_plan_posted_run_token` in Vault to match what's now live on the edge functions; full Stage 2 runbook already in scratchpad `washedup-token-rotation-plan.md`) or revert it (set the edge-function secrets back to their original values). Live-check current state first, don't assume either half is still true.
- Push the 3 commits to origin: needs Josh's push word, separate from commit approval, never asked this session.
- Old duplicate-friend-rows cleanup migration (`20260330000000_remove_symmetric_friend_rows.sql`): still staged, still a real judgment call on live rows, still unresolved.
- Send the Liz file, or extract its questions into whatever channel Josh actually uses with her (text/call), Josh's own action.
- TestFlight build: needs Josh's real go on cost before anything happens.
- command-center-next real status and Josh's Gmail: both need a fresh login before Claude can check either again.
- AGENTS.md: still an unexplained untracked file at repo root, still not investigated, low priority.

## Next: expiring

- The half-done rotation is the most time-sensitive item in this whole handoff, treat it as should-resolve-same-day, not a someday item.
- Metro/simulator processes won't survive a Mac restart.
- Liz's Scene scope doc: still "targeting Monday" per her 8/13 reply, unchanged.

## Blockers

- Vercel and Gmail MCP sessions both expired, need fresh logins.
- Everything else is Josh's decision, not a technical blocker.
