# Mega-run digest triage, 2026-09-02

## The source list could not be located as stated

Four handoffs tonight (`crucible-T5315-ota-live-fix-pushed-audit-running-20260902-1030.md`,
`-batch-closed-qa-all-green-20260902-0815.md`, `-scene-chat-pushed-ota-blocked-20260902-0931.md`,
`-ticket-webhook-incident-fixed-liz-batch-drafted-20260902-1300.md`) all carry forward, unchanged, the
line: "30 items tagged 'needs more investigation' and 11 tagged 'already fine' from an earlier mega-run
digest, still untriaged." No file anywhere in `clients/washed-up/` contains those phrases, those counts,
or anything close to a 41-item enumerated list. Checked: every handoff (including all lowercase
`crucible-t5315-*` and older `crucible-T5050-*` variants back to 2026-08-18), `~/.claude/audit/digests/`
(no washed-up entry exists there at all), every workflow `journal.jsonl` under this Mac's Crucible project
directories (grepped globally for the literal phrases — zero hits), and `~/.claude/bin/recall` (returned
unrelated hits — a testflight correction, a stale-memory report, an unrelated 2026-08-23 reconciliation —
none matching). **Conclusion: that exact 30/11 figure has no recoverable primary source. Whoever wrote the
first instance of that line was very likely paraphrasing/miscounting a real audit's findings, not quoting
a real list. Stop carrying that specific sentence forward — it cites nothing that exists.**

## The real audit that line most likely refers to

The most plausible actual source is `wf_641f05e5-289`, a 3-agent read-only workflow that ran the same
night, right before the 10:30 handoff that first mentions the 30/11 line. It produced 22 "already done"
findings and 23 "gap" findings across three areas (migration truth, P2 free-RSVP outbox, P0 monitoring) —
45 items total, not 41, but the closest real thing found by a wide margin, same session, same night. Full
triage below, every item re-checked live just now, not trusted from the ~8-hour-old journal text.

## Area 1: Migration truth (core-01)

**Already-done, re-verified live just now, all still hold:**
- `static-contracts.mjs` passes: re-ran it, `PASS: 257 migration files satisfy static contracts`, exit 0
  (was 256 files at audit time — this session's ticket-webhook-fix migration added the 257th).
- Held vs. superseded separation by directory: unchanged, structural.
- `run-private-sql-contracts.sh` real ~20-lane harness: unchanged, confirmed present.
- Historical `unresolved_versions`/`unresolved_chains` all resolved: unchanged.

**Gaps, re-verified:**
1. **Direct-apply provenance is hand-transcribed prose, never machine-verified against real production** —
   still true, unchanged. Needs either production read-credentials wired into a script, or accepting
   human-relay as the permanent method. Real, but it's a Josh call on production access, not something to
   fix by more investigation.
2. **HELD migration counted as active — FIXED this session.** Re-ran `static-contracts.mjs` live: it now
   lists `supabase/migrations/20260813192000_create_stripe_webhook_events_HELD_pending_deploy.sql` under
   `HELD:` and release candidates correctly exclude it. This exact gap is closed.
3. **`technical-moderation-alternative.sql` has no `held_migrations` record** — confirmed still true, but
   the original audit already found this looks intentional (docs independently call it "contingent,"
   "not an approved build plan," one level below even a held proposal). No action needed.
4. **"Boot the full local baseline" doesn't exist — partially fixed this session.**
   `scripts/db-contracts/local-baseline-replay.sh` now exists and runs, but breaks on migration file 1 of
   255 because plain local Postgres has no Supabase-managed `authenticated` role. Real progress, not done.
5. **No live drift count is ever computed** — still true, unchanged. `drift-classifier.mjs` still only
   runs against a fabricated fixture, never real data. Needs a production-read decision, Josh's call.
6. **`qa:all` only exercises 1 of ~20 private contract lanes** — still true, unchanged. This is a real,
   fixable CI-coverage gap and does NOT need Josh's production access to fix — wiring more of
   `run-private-sql-contracts.sh`'s lanes into `qa:all` is a local script/CI-config change. Worth a real
   follow-up ticket, not a Josh-gated item.

## Area 2: P2 free-RSVP outbox

**Already-done, re-verified:** schema + worker + shared logic all still committed on main, `qa:confirmations`
was reported 15/15 at audit time (not re-run here, low risk of regression since nothing touched this code
tonight), `deno check` clean, full typecheck clean, config.toml correct, release-safety tooling present.
Provenance ledger note needs a trivial update: it had "3 entries, none match" at audit time; it's 4 entries
now (tonight's ticket-webhook fix) and the conclusion is unchanged — still none of the 4 match these RSVP
migrations.

**Gaps, all re-verified, all still open, all correctly Josh-gated (no further investigation changes any
of them, they're a sequential release checklist):**
1. **`qa:g0:local` still fails** — re-ran it live just now: same two exact failures,
   `140_consent_sync_fixture.sql` and `141_consent_sync_contract.sql` hash-drifted from the frozen G0
   manifest (from commit `2526d98`, an unrelated later phone-auth-regression fix). Unchanged, still needs
   Josh's judgment call that the drift is safe, then a hash refreeze. This is the same item already named
   in tonight's other handoff — confirmed still accurate, not stale.
2. Production migration apply — not done, needs Josh + real migration apply.
3. Edge Function deploy — not done, needs Josh + real deploy.
4. Vault run-token creation — not done, needs Josh + real credential action.
5. `activation_mode` flip to `seed_only` — not done, needs Josh + real DB write.
6. Cron schedule step — not done, needs Josh + real migration apply.
7. Seed-account canary send — not done, needs Josh approval (sends one real email).

## Area 3: P0 monitoring

**Already-done, re-verified:** release-gap and drift-sentinel are still genuinely healthy (re-ran
`heartbeat-status.sh` live: `HEALTHY drift-sentinel 53h old`, `HEALTHY release-gap 19h old` — both still
green, ages consistent with time elapsed since the original audit). washedup_monitor_ro role, Tier A/B/C
doctrine, fixture tests: unchanged, structural.

**Gaps, re-verified live just now:**
1. **Hetzner crontab still has zero active schedule** — re-checked via a fresh read-only SSH call just
   now: still exactly two orphaned comment lines, no actual cron syntax for any WashedUp responder.
   Unchanged from the audit. Confirmed matches tonight's other handoff's "Hetzner monitoring cron was
   never actually installed" item — same real gap, still open, needs Josh's go (always-on server).
2. **`cron-watchdog.sh` silent-failure bug** — real, root-caused precisely (a `sed`/`jq` pipeline in
   `lib/db.sh` treats empty CLI output as an empty-but-valid JSON stream instead of a failure, so the
   script exits 0 having written nothing on all 8 of its real runs). Not re-run live here since it needs
   the actual LaunchAgent environment to reproduce, and this triage pass is read-only/no-fix scope — but
   the diagnosis is specific enough (exact file/lines) to hand straight to a fix task.
3. **Heartbeat mechanism (`write_heartbeat`, `heartbeat-status.sh`, `state/heartbeats/`) still 100%
   uncommitted, still absent from the server** — re-checked: `git status --short clients/washed-up/ops/`
   from the Crucible root shows 24 modified/untracked paths right now (was 25 at audit time — consistent,
   not regressed, not yet committed). Needs a "commit" word before anything here is real outside this Mac.
4. **Live heartbeat-status.sh still shows 3 of 5 MISSING** — re-ran it just now: `MISSING cron-watchdog`,
   `MISSING secret-pair`, `MISSING weekly-draft`, exit 1. Identical to audit time. Unchanged, real, not
   fixed by anything this session touched.
5. **0-byte heartbeat file bug in `write_heartbeat`** (a `jq -n` object construction with a `select()` on
   an empty string collapses the whole object to zero output records) — real, root-caused precisely, same
   file/function as #2's fix target. Not independently re-reproduced in this pass; the original agent's
   reproduction in an isolated tmp dir with zero real file writes is credible as-is.
6. **Sentry `check.sh` structurally disconnected from the heartbeat/receipt system** — confirmed still
   true (self-documented in its own header as a detection-only scaffold). Not urgent, no action implied.
7. **Roster documentation disagrees across files** (original plan names 9 items, README lists 4, config
   lists 5, two working-but-never-scheduled scripts — `lizdocs/watch.sh` and `registry/update.sh` — exist
   for items nobody automated). Real, and worth naming directly: `lizdocs/watch.sh` already does exactly
   what this project's own CLAUDE.md says must happen "the same session" a new Liz doc appears, and today
   that's still being done by hand every time because this already-built watcher was never scheduled. This
   is a real, low-risk, non-protected fix (add a LaunchAgent) once Josh says go on a new Mac scheduled task.
8. **weekly-draft's LaunchAgent is installed despite its own header saying it needs a separate Josh
   decision** — real mismatch between doc and reality, already fired once successfully (produced a real
   draft 2026-08-28). Not urgent to unwind; worth a one-line comment fix later, not a live risk today.
9. **Deliverability canary (roster item 9) not started** — confirmed accurate, not a discrepancy, the
   source doc already says so correctly.
10. **`ops/` tree substantially uncommitted** — same as #3 above, 24 paths, needs a commit word.

## Net count

Nothing here supports "30 needs more investigation, 11 already fine" as a real, distinct classification.
The real, closest-match audit had 45 total findings (22 confirmed-working, 23 gaps), and every single gap
in it is either (a) already fully understood with a named root cause and just waiting on Josh's word for a
protected action, or (b) a real but non-protected follow-up fix (the `qa:all` lane-coverage gap, the
`lizdocs`/`registry` scheduling gap, the two precisely-diagnosed shell/jq bugs) that could be picked up as
ordinary engineering work without needing anything from Josh first. None of the 45 are still genuinely
ambiguous or need more investigation to even understand — the investigation already happened once, tonight,
correctly. The next real step for this backlog is fixing the non-protected items and queueing the
protected ones for Josh, not re-investigating anything.
