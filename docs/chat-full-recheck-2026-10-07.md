# WashedUp chat: full scoped recheck — October 7, 2026

Latest continuation: **2,557 passing tests, 11 unchanged baseline failures,
176 suites**, plus **99 isolated PostgreSQL assertions**. The private-chat
blocking continuation at the end records the client entry/profile safeguards
and a review-only, undeployed server contact boundary.
Earlier correctness, simulator and transport results remain separately identified.

## Initial full-recheck result

Reviewed the accumulated chat changes against protected release commit
`9c2994b10e9f263e98a262e87a9bf7a94ee941c5`, reran the expanded chat/adjacent
regression inventory, and repeated the real local multi-client transport lab.
One further recovery gap was found and fixed: typing channels now wait for the
SDK's closing socket before subscribing. A delayed join is cancelled when its
room/account visit ends. Shared broadcast names, payloads, throttling and expiry
remain intact. Message content, authentication and push registration are unchanged.

**Final distinct inventory: 168 suites; 164 passing suites; 2,430 passing tests,
11 failing tests, zero pending.** Failures are the previously documented baseline
failures below. This is the complete selected chat/adjacent inventory, not the
entire repository, proof of production health, or a claim that every bug is gone.

## Evidence and boundaries

| Area | Rechecked | What this establishes |
| --- | --- | --- |
| Sending and retries | Exact receipts, lost acknowledgements, same-UUID retry, delayed sends, wrong sender/room/body/mention rejection | Automated app contracts and real local topic transport recovery |
| Drafts and identity | New typing during old sends/reads, navigation, account retirement, saved attempts, storage errors, nested replies | Hook/component/storage contract coverage; not every native input ordering |
| Realtime and return | Coalesced refresh, room revisits, foreground return, socket close, online/offline deadlines | Synthetic lifecycle tests plus 60 real local message reconnect cycles |
| Typing | Late joins, retired callbacks, throttle/expiry, malformed payloads, reconnect status | Two new regressions plus 20 real local shared-name broadcast reconnect cycles |
| History and privacy | Pagination, anchors, early main-history display, block checks, admission changes, retired reads | App contract coverage; local RLS fixture denies outsiders and sender impersonation |
| Attachments and actions | Photo/voice retry, immutable upload IDs, edit/reply/reaction lifetimes, menu and accessibility adapters | Mocked storage/media/component checks; no real Storage or microphone exercise this pass |
| Keyboard and scrolling | Keyboard adapters, input-height contracts, list anchors, repeated lifecycle cases | Automated logic checks; no physical keyboard, frame-rate or native soak measurement |
| Startup and release protections | Selected phone auth/onboarding/OTP/navigation/push-entry suites, auth invariants, protected source comparison | No startup/auth/backend/native configuration difference introduced by this branch |
| Packaging | TypeScript, offline iOS JavaScript/Hermes export, lab syntax, diff whitespace | Source/package checks passed; no native build or OTA was published |

Source review included the accumulated production changes to shared/topic/main
chat, durable composer handoff, receipt checks, progressive history and its
privacy gates, local pending rows, upload retry identity, foreground refresh,
network probes, Realtime subscription ownership and development-only timings.
No new product change was made where the review did not establish a defect.

The 168 suites ran in independent Jest processes, two concurrently, with a
60-second per-suite limit and normal exits. None timed out. After the typing
repair, its final 18-case suite replaced its prior 16-case result in the summary;
reruns are not added together. The typing suite and shared subscription helper
also passed together (23 tests). The two new cases failed before the hook fix.
The installed SDK source was inspected: its connect operation can defer while
the last socket is closing. The existing app helper owns the delayed join and
cancels it on visit retirement; this hook now uses that same helper.

The real local lab passed **11 scenarios** using three authenticated member
sessions and a local administrative fixture client. It verified 186 distinct
message rows, 60 receiver disconnect/reconnect cycles, a 40-message concurrent
burst, twenty missed-message recovery, lost-response recovery, same-ID retry,
Unicode, access rejection and archived-room refusal. An added typing scenario
received all 40 both-way broadcasts across 20 receiver teardowns, observing
22 SDK closing windows. These are bounded transport exercises, not days-long
native testing or phone latency measurements. The lab uses a scoped policy
fixture, not the complete deployed schema. Production requests: zero. The
local stack was stopped successfully after the run.

## Existing failing checks retained

| Suite | Failures | Baseline evidence |
| --- | ---: | --- |
| `components/creator/__tests__/CreatorToday.approvedEntry.test.tsx` | 1 | Existing ProfileButton query mock returns undefined; reproduced on the preceding unchanged hook in the network-recovery pass |
| `components/creator/__tests__/CreatorToday.reads.test.tsx` | 7 | Same query mock problem and baseline reproduction |
| `lib/__tests__/communityPageRead.test.ts` | 1 | Undefined community-page query fixture; previously reproduced at the protected release |
| `lib/__tests__/setupCommunityLanding.test.ts` | 2 | Creator-setup source assertions expect older navigation/invalidation strings; previously reproduced at the protected release |

These are failures, not passing checks or proof of correct product behavior.
They remain outside the scoped chat repair. No tests were skipped, assertions
weakened or unrelated production code changed to improve the reported count.

## Remaining validation

- The exact integrated candidate still needs a permitted installation on a
  matching device/binary. This pass did not update the existing simulator
  fixture or install an app. Previous simulator evidence is separately dated.
- Rapid send-and-type is still uncertain on native input: earlier results did
  not establish whether the remaining intermittent case is app timing, the
  existing development binary or automation. No speculative text stripping,
  input remount or native event-count patch was introduced.
- Cold-open speed, frame pacing, keyboard movement, long native memory behavior,
  weak-network photo/voice transfers, OS suspension and notification delivery
  remain unverified on the matching device. A mirrored phone helps with visible
  interaction; independent receiving-session evidence is still needed for
  end-to-end delivery. The local lab provides separate transport evidence.
- Production policies, real Storage, provider push and Android compatibility
  were not tested by this isolated lab. No backend changes were deployed.
- Verification used available Node 24.19 with existing dependencies. The
  specified Node 20.20.1 environment and full release pipeline still require
  normal integration checks. No standalone lint script is configured.
- A durable multi-message offline outbox remains a separate feature. Current
  recovery keeps one original attempt with explicit check/retry; this audit
  does not turn it into background queued messaging or establish WhatsApp parity.

Once an approved matching test version exists, Liz's useful contribution is a
short realistic conversation: send several messages quickly, type immediately
after Send, exchange a photo and voice note, reply/react/edit, scroll older
history with the keyboard open, and repeat after leaving and reconnecting.
Record the room and action when something feels wrong. No debugging expertise
is expected, and no immediate founder action is required for this saved audit.

## Release isolation and changed files

Started this pass at `515fbaa42bf592347a41ce4668e006b2b2f35b4d` on
`feature/chat-loading-20261006`, in the existing isolated worktree. Fetched
origin without changing checkout files. Canonical remote remains
`https://github.com/lizwashedup/WashedUp.git`. The protected release ref remains
`9c2994b10e9f263e98a262e87a9bf7a94ee941c5`, an ancestor of this feature branch.
No merge, rebase, push, deployment, production mutation, notification send,
native build, signing or publishing was performed.

Files changed in this pass:

- `hooks/useTypingIndicator.ts`
- `hooks/__tests__/useTypingIndicator.lifetime.test.tsx`
- `scripts/chat-lab/run.mjs`
- `scripts/chat-lab/README.md`
- `docs/chat-full-recheck-2026-10-07.md`

No native input or dependency changed; the app change is structurally
OTA-compatible with the protected base and adds no next-native-build item.
That compatibility statement is not permission to publish.

Evidence directory:
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/full-recheck-20261007/`.
It contains the explicit suite list, repeatable bounded runner, individual logs
and JSON reports, reconciled summary, typing before/after logs, local transport
report, stack start/stop logs, TypeScript/auth/export logs, and final candidate
metadata plus full changed-file list and patch against the protected release.


## Additional adversarial review — October 7

Continued from `b29b11bc74f284227b0af7fcb874d98fe05117c0` after Liz requested
another gap-focused review. Verified the clean isolated feature checkout,
canonical remote and unchanged protected release ref, then fetched origin.
Inspected save-queue ordering and recovery, delayed callbacks after navigation,
attachment session ownership, mutation deadlines, the real library contracts
behind test doubles, and the user-facing handling of uncertain deletion.

Two further bounded defects were reproduced and repaired:

1. **Stale preparation failures:** a failed attempt-storage write could mark the
   composer as errored after a subsequent queued write had successfully saved
   the same original attempt and newer text. The outer preparation catch
   bypassed the existing write-revision guard. It has been removed in both
   draft hooks; `persist` now exclusively owns storage error state. Four tests
   use the real ordered storage helpers, inject failure at AsyncStorage, verify
   the subsequent durable contents, and verify explicit retry retains the
   original UUID and next text. No transport starts from the failed preparation.
   Latest-write failures and stalled storage still expose recovery.
2. **Unbounded deletes:** shared and topic-owned deletion, plus the topic
   moderation service, could wait indefinitely for an unanswered request.
   Each now has a 12-second deadline. Existing identity guards, selected-row
   rollback and delete filters remain. No automatic repeat/delete or new
   permissions were added. A timeout is explicitly described as **Removal not
   confirmed**, with reopening the chat suggested to check the actual outcome.
   A deadline is not proof that the server failed to commit the removal.
   Four hook cases cover active and retired accounts; one service case checks
   moderation filters and single dispatch; one screen case checks truthful copy.

Nine regression executions failed on the preceding implementation (four real
storage-queue cases, four owned-delete cases, one moderation case). The final
candidate passes all ten newly added cases, including the timeout-copy check.
The new screen case also exposed an order-dependent test-fixture leak:
`spyOn` reused the preset's AppState mock and `mockRestore` cleared its listener
implementation. The lifecycle test now restores the original mock implementation,
so subsequent tests still receive removable subscriptions. No application
cleanup checks were weakened and the full screen suite passes in order.

The complete selected **168-suite** chat/adjacent inventory was rerun in separate
Jest processes, with final affected-suite reruns replacing earlier results:
**164 suites passing, 2,440 tests passing, the same 11 baseline tests failing,
zero pending and no per-suite timeouts.** The four failing suites remain listed
above. Jest discovery found 561 repository suites; this is deliberately not a
claim that all 561 or the full release pipeline passed. No unrelated failure
was repaired or hidden. Temporary diagnosis logs were removed from source.
TypeScript, auth invariants, diff whitespace and offline iOS JavaScript/Hermes
export passed. Final export: `/tmp/washedup-chat-adversarial-recheck-export-final-20261007`.

The local transport lab was not rerun in this continuation because its transport
helpers and schema were unchanged; the preceding 11-scenario run is the latest
integration evidence. Native/production/Node-20 limitations above remain open.
No native dependencies or configuration changed; these fixes are structurally
OTA-compatible and add no future-native-build requirement. Nothing was merged,
pushed, built natively, installed, deployed, published or sent to members.

Files changed in this continuation:

- `app/community-topic/[id].tsx`
- `components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx`
- `hooks/useChat.ts`
- `hooks/useTopicChat.ts`
- `hooks/useChatComposerDraft.ts`
- `hooks/useTopicComposerDraft.ts`
- `hooks/__tests__/useChat.ownership.test.tsx`
- `hooks/__tests__/useTopicChat.mutations.test.tsx`
- `hooks/__tests__/useChatComposerDraft.prepare.test.tsx`
- `hooks/__tests__/useTopicComposerDraft.test.tsx`
- `lib/communityChat.ts`
- `lib/__tests__/communityOperationScope.test.ts`
- `docs/chat-full-recheck-2026-10-07.md`

New evidence is in the sibling `evidence/adversarial-recheck-20261007/` directory:
before/after reproductions, suite discovery and selected inventory, individual
reports, reconciled summary, final checks and candidate/release comparison.
The earlier evidence remains intact. This audit reduces known uncertainty; it
does not prove an absence of all defects or replace matching-device testing.

## Scroll recheck — October 7, 2026

Work continued in the existing isolated worktree
`/Users/liz/Desktop/WashedUp_HQ/washedup-chat-loading-20261006`, on
`feature/chat-loading-20261006`, from clean commit
`63a6b81f9d733485545a124a6039f131c52b0e10`.
`git fetch origin` succeeded. Origin is the canonical
`https://github.com/lizwashedup/WashedUp.git`. The protected local release ref
and merge base remain `9c2994b10e9f263e98a262e87a9bf7a94ee941c5`.
No release ref, production data, native config, dependency or deployment changed.

### Findings and repairs

- Shared, topic and main chat could issue offset-zero scrolls between finger-down
  and the first scroll event. A native gesture now suspends following immediately;
  drag/momentum completion resumes it only within two points of the newest edge.
  Previously the tolerance was 24 points in shared chat and 80 in community chat,
  enough to pull a partly scrolled older bubble back toward the composer.
- Topic layout/content callbacks used React state captured before a queued scroll
  update. They now consult the synchronous position ref, including when scroll
  and layout callbacks occur before React commits. Community scroll callbacks
  now receive updates at a 16ms throttle instead of 100ms; this is configuration,
  not a measured frame-rate claim.
- Shared reply jumps used an uncancelled 300ms retry with the original array
  index. They now have at most four index attempts, one pending timer, current
  message-ID lookup on each attempt, and cancellation for drag, Latest/send,
  room/account/history-window retirement and unmount. Deletion of the target
  also ends the attempt. Reply jumps suspend automatic following first.
- Route-anchor recovery bounded index jumps but still issued approximate offset
  jumps after exhaustion. Both now stop at the same limit. A drag cancels pending
  animation frames and late target-layout corrections; unmount retires the request.

Review also covered inverted-list direction, live-edge viewport preservation,
keyboard-show scrolling, composer measurement/touch gating, arrival counters,
older-history loading, memoized shared message rendering, and existing privacy
and entry guards. No native freeze/crash root cause is claimed beyond the
reproduced conflicting-scroll-command paths.

### Verification

Four added cases failed against the pre-fix behavior: shared drag/layout,
topic same-turn drag/layout, anchor retry exhaustion and anchor drag takeover.
The pre-fix combined log also exposed a shared-screen test cleanup problem:
its foreground test restored an existing AppState mock to an empty function.
The original mock implementation is now preserved for subsequent tests. This
is test isolation work, not a production AppState change.

Final inventory: **170 suites; 166 passing suites; 2,454 passing tests;
11 failures; zero pending; zero suite timeouts.** Fourteen cases were added.
The same four unrelated baseline suites account for all failures:
CreatorToday.approvedEntry (1), CreatorToday.reads (7), communityPageRead (1),
and setupCommunityLanding (2). Baseline reproduction is recorded above.
Six directly affected suites also passed independently: **164 tests**.
They cover all three real screen components plus follow/anchor/reply hooks,
keyboard-versus-drag, momentum, same-turn layout changes, disappearing targets,
new arrivals shifting indices, duplicate failure callbacks and retired retries.
Reruns replace earlier results in the inventory rather than increasing totals.

TypeScript `--noEmit`, auth-invariant checks, diff whitespace and offline iOS
JavaScript/Hermes export passed. There is no standalone lint command configured.
The available Node runtime is 24.19; the repo-pinned 20.20.1 was not available.
No native build/install, OTA or backend deployment was performed.

Evidence directory:
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/scroll-recheck-20261007/`
contains the selected suite inventory, per-suite results, final affected-suite
results, pre-fix log, check logs and protected-base comparisons.

### Native preview: what was and was not verified

The existing `com.washedup.localdev` preview on the iPhone 17e iOS 26.4 simulator
was reloaded from the isolated source. Its visible marker is
`Chat scroll checks r8 · Local only · Mona loaded`. All three real chat screens
loaded the fictional 500-message mode and navigation remained responsive.
Topic input focus opened the native software keyboard with long history loaded.
No real account, message, notification or production endpoint was used.

The preview uses existing localdev 1.0.6/build44 native binaries, actual current
chat components, and mocked transport/identity/permissions. It is not Build51
native parity, full community mapped-history integration, or a live-network test.
The original CI-mode Metro was restarted with interactive reload enabled solely
for this fixture. UI scroll/drag commands repeatedly returned the control-tool
error `noWindowsAvailable`, although AX clicks and inspection worked. Therefore
this pass does **not** certify manual native drag/fling behavior, FPS, cold-open
latency, or an endurance/soak result. A 500-row mount is not a scroll benchmark.

The remaining useful phone check is fast repeated flicks while messages arrive,
opening/dismissing the keyboard while reading older messages, and tapping a
reply then immediately dragging away. Test on the intended native build after
integration; the control-tool error does not establish an app freeze.

### Every file changed in this continuation

- `app/community-thread/[id].tsx`
- `app/community-topic/[id].tsx`
- `components/chat/ChatThread.tsx`
- `components/chat/__tests__/ChatThreadComposerAccessibility.test.tsx`
- `components/chat/__tests__/CommunityMainQueryIsolation.test.tsx`
- `components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx`
- `hooks/useChatMessageAnchor.ts`
- `hooks/useChatReplyScroll.ts`
- `hooks/useChatScrollFollow.ts`
- `hooks/__tests__/useChatMessageAnchor.test.tsx`
- `hooks/__tests__/useChatReplyScroll.test.tsx`
- `hooks/__tests__/useChatScrollFollow.test.tsx`
- `docs/chat-full-recheck-2026-10-07.md`

The external native fixture's `index.tsx` changed only its verification marker;
verification logs and exports remain outside the feature checkout. The temporary
node_modules symlink is removed before commit. These fixes are JavaScript-only
and require no new native dependency/configuration; they are OTA-compatible in
that limited source sense, subject to the existing Build51 integration/release
gates. They have not been published. Release, push, auth, OTP, account lifecycle,
backend and native configuration paths have no new diff in this continuation.

## Final crosscheck — October 7, 2026

This requested pass started from clean isolated feature commit
`204aa642688e410df43cc18ed6de6ac623784de6` on
`feature/chat-loading-20261006`. The canonical origin and protected release
commit `9c2994b10e9f263e98a262e87a9bf7a94ee941c5` still match.
Remote fetch succeeded without changing files or the protected release ref.

### Scope and finding

Reviewed sending/receipt recovery, durable draft ordering, attachment attempts,
room/account retirement, history/pagination/privacy gates, arrival counters,
reply/notification anchors, gestures, keyboard layout adapters, foreground
refresh, network-probe cleanup and Realtime subscription ownership. Selected
phone-entry/onboarding/OTP/notification-navigation regressions ran as well.
Account-deletion and native/backend configuration paths were compared for
unintended changes; no live account deletion or full-schema contract execution
is claimed in this pass.

One interaction defect was reproduced: a send completed after a reader dragged
into older history and still forced a jump to the newest message. The previous
fix stopped layout/keyboard callbacks fighting gestures, but had not covered
these asynchronous completion callbacks. Seven new component cases failed
before this repair: shared text and main/topic text/photo/location sends.
The unchanged-reader control passed, establishing that ordinary follow-after-
send behavior must be retained.

The shared scroll hook now captures a viewport-choice revision for each send.
New drag, momentum, wheel/accessibility movement off the edge, or explicit
Latest/entry reset supersedes that revision. Completion can follow only while
its captured choice remains current. The guard covers shared text, voice,
GIF, photo and location completion paths, plus main/topic text, photo and
location. It changes viewport behavior only: confirmed sends still finish,
clear the original attempt, retain newer drafts, refresh history and release
pending controls. Existing account/admission guards still apply.

No other reproducible defect was established in this pass. This means the
reviewed/tested scope passed its stated checks, not that all possible app bugs
or native freezes have been ruled out.

### Verification and evidence

- Final complete selected inventory on the updated code: **170 suites,
  166 passing suites, 2,467 passing tests, 11 failing tests, zero pending,
  zero timeouts**. The same CreatorToday.approvedEntry (1), CreatorToday.reads
  (7), communityPageRead (1), setupCommunityLanding (2) baseline failures remain.
  No additional failure was found. All suites ran in independent Jest processes
  with two workers and 60-second per-suite bounds.
- Thirteen cases added: eight mounted-screen cases (including the positive
  no-new-gesture control) and five scroll-intent lifetime cases. The nine
  directly affected suites also passed independently: **319 tests**. Counts
  above are distinct tests, not totals of repeated runs.
- TypeScript, auth-invariant script, diff whitespace and offline iOS
  JavaScript/Hermes export passed. Available Node 24.19 used; pinned Node20.20.1
  unavailable. No standalone lint command configured.
- Repeated the existing isolated native Supabase fixture lab: **11 scenarios
  passed**, 186 distinct messages, three authenticated client sessions,
  60 message reconnect cycles, 20 typing reconnect cycles, 22 observed closing
  socket windows. Included bidirectional delivery, Unicode, 40 concurrent sends,
  same-ID deduplication, lost response, 20 missed messages recovered via history,
  outsider rejection, sender impersonation rejection and archived-room refusal.
  Production requests: **zero**. The local stack was stopped after verification.
- This was a bounded local transport run with a fixture schema, not production
  policy parity, real Storage/media/push, native suspension or phone performance.
  No new native simulator/phone gesture, cold-start, frame-rate or endurance
  measurement is claimed. The r8 simulator/tool limitation in the preceding
  section remains open.

Evidence:
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/final-crosscheck-20261007/`
contains final selected-suite results, the 319-test affected run, the transport
report, typecheck/auth/export logs and protected-base/continuation comparisons.
The pre-fix seven-failure counts were observed in tool output; their individual
logs were overwritten by the immediate succeeding 177-test run. That limitation
is recorded in `regression-observations.txt`; the directory called
`initial-regression-pass` contains the succeeding pass, not a pre-fix log.

### Every file changed in this continuation

- `app/community-thread/[id].tsx`
- `app/community-topic/[id].tsx`
- `components/chat/ChatThread.tsx`
- `components/chat/__tests__/ChatThreadComposerAccessibility.test.tsx`
- `components/chat/__tests__/CommunityMainEntryLifetime.test.tsx`
- `components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx`
- `hooks/useChatScrollFollow.ts`
- `hooks/__tests__/useChatScrollFollow.test.tsx`
- `docs/chat-full-recheck-2026-10-07.md`

This change is JavaScript-only and OTA-compatible in source terms; it introduces
no native dependency or configuration requirement. The existing integration and
Build51 release gates remain. Nothing was merged, pushed, published, built or
deployed. No production data, push, auth, OTP, lifecycle, Supabase or native
configuration was changed. The temporary dependency symlink is removed before
commit. The remaining practical acceptance step is testing this exact candidate
on the intended phone binary, especially scrolling during arrivals/delayed sends
and keyboard transitions; there is no new founder setup requirement for the
completed code and local transport checks.

## Scroll and speed pass — October 7, 2026

Started from isolated feature commit
`44ac226fd9a192fc52bc7e23edcaa90b42adf684` on
`feature/chat-loading-20261006`. The initial tracked worktree was clean;
the canonical origin, protected release ref and ancestry still matched
`9c2994b10e9f263e98a262e87a9bf7a94ee941c5`. Remote fetch completed without
changing working files. The only temporary checkout addition was the dependency
symlink, removed before the final commit.

### Changes and measured scope

1. Community local delivery now retains the same message-array reference during
   unrelated composer/keyboard renders. With no extra local rows it returns the
   authoritative history directly, avoiding a history scan and array copy.
   Pending status, confirmations, early echoes, same-ID edits, deletes and
   account/room retirement retain their existing behavior. Memoization depends
   on the complete history array, not a list of IDs.
2. LA date grouping reuses one explicitly LA/en-US formatter instead of creating
   two formatters per adjacent-row comparison. Relative today/yesterday labels
   still read the current day; device-local time labels are unchanged. There is
   no unbounded message/timestamp cache.
3. LinkifiedText memoizes parsing only. Current styles, full-link presentation,
   accessibility and profile callbacks still render from current props. The
   existing nested Text structure and Dynamic Type remount are retained. Text,
   known-name sets and authoritative identity documents invalidate the parsing.

Three new performance assertions failed against the unchanged source, then
passed after the optimizations. Both runs are preserved separately. Ten cases
were added overall, including LA midnight/year/DST boundaries, changing day
labels, delivery status/edits, current profile callbacks and cleared identities.

| Measurement | Before | After | Scope |
| --- | ---: | ---: | --- |
| Parsing during mount + 25 unchanged parent updates | 26 calls each | 1 call each | Identity, URL and mention parsers in mounted component tests |
| Unchanged 500-row community list during 25 parent updates | New array each render | Same history reference | Hook regression; does not imply all FlatList rows avoid rendering |
| 499 adjacent LA-day comparisons over 500 synthetic timestamps | 19.91 ms median | 0.49 ms median | 21 paired Node CPU rounds, alternating order after warmup |

The last row measures only that helper, not overall chat speed, native frames,
network delivery, or app cold start. Separate initial-process measurements are
also retained; single cold samples are too noisy to establish launch improvement.
No native frame-rate or production latency claim is made.

### Review and checks

- Rechecked list follow/gesture ownership, bounded reply and notification-anchor
  retries, content-size/layout callbacks, keyboard adapters, delayed-send scroll
  guards, local delivery lifecycle, grouping and rich-text updates. Retained the
  existing privacy/admission/account gates and transport behavior.
- Final selected inventory: **172 suites, 168 passing suites, 2,481 passing
  tests, 11 failing tests, zero pending and zero timeouts**. The four failing
  suites and their 11 baseline failures match the earlier documented results;
  no unrelated fixes were made. Each suite ran in its own Jest process, at most
  two concurrently, with a 60-second bound. This is the selected chat/adjacent
  inventory, not every repository test.
- The four directly affected suites passed independently: **23 tests**.
  LinkifiedText's existing mention suite and new performance suite were added
  to the wider inventory. This accounts for four previously unselected tests
  plus ten newly added cases; repeated runs are not added together.
- TypeScript, auth invariants, whitespace checks and offline iOS JavaScript/
  Hermes export passed. Node 24.19 was available; pinned Node 20.20.1 remains
  unavailable. No standalone lint command is configured.
- The preceding local multi-client transport run remains evidence for unchanged
  transport paths. It was not rerun or counted as new verification in this pass.

### Updated native fixture observation

Reloaded the existing iPhone 17e / iOS 26.4 simulator fixture with marker
`Chat speed checks r9 · Local only · Mona loaded`. It imports this checkout's
actual screen/component source and runs inside the existing local development
binary (1.0.6/build44). It is **not** the protected Build51 binary. The fixture
uses synthetic identity/history/send services with external networking blocked.

All three surfaces — shared, main community and topic — loaded their 500-row
fixture, opened the native keyboard, accepted an on-screen key and completed
a local send with the composer cleared. These are functional observations;
tool-call durations are not send/typing latency measurements.

One topic scroll action was accepted and displayed Latest; tapping Latest then
visibly returned the new message fully above the composer with the keyboard
open. Longer scroll/drag attempts encountered ScreenCaptureKit capture failure
and `noWindowsAvailable`. Thus long-history gesture endurance, animation/FPS,
repeated keyboard transitions and physical-device feel remain unverified.
The control-tool failures do not themselves establish an app freeze.

Metro also emitted a VirtualizedList slow-update warning (`dt: 44533`,
`prevDt: 35308`). The installed list source calculates these values from the
interval between scroll-event timestamps, not a measured render duration;
the warning cannot be read as a 44-second render. It is retained as an unresolved
profiling signal, not dismissed as proof of smoothness or treated as a reason
for an unmeasured list-engine rewrite.

### Every file changed in this continuation

- `components/LinkifiedText.tsx`
- `components/__tests__/LinkifiedText.performance.test.tsx`
- `hooks/useCommunityLocalDelivery.ts`
- `hooks/__tests__/useCommunityLocalDelivery.test.tsx`
- `lib/communityChatUi.ts`
- `lib/__tests__/communityChatUi.test.ts`
- `docs/chat-full-recheck-2026-10-07.md`

Evidence is outside the checkout at
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/scroll-speed-20261007/`:
before/after source and test evidence, the 172-suite inventory/results, paired
benchmark script/results, typecheck/auth/export logs, simulator observations,
and final comparisons with both this pass's starting commit and the protected
release. The external fixture changed only its visible verification marker.

These changes are JavaScript-only and require no new native dependency or
configuration. They are OTA-compatible in source terms, subject to the existing
Build51 integration/release gates; nothing was published. Release/push/auth/OTP/
lifecycle/native/backend configuration paths were not edited by this pass.
No production requests, notifications, builds, deployment, merge or push occurred.
The next useful acceptance step remains sustained scrolling and keyboard testing
on the intended phone candidate after safe integration. This pass establishes
specific reduced work and passing scoped regressions, not a guarantee that all
possible freezes or errors have been eliminated.

## Blocking, private inbox and chat consistency — October 7, 2026

Liz reported that a blocked person's message and picture remained visible and
clarified that this was a **private chat or inbox**, not a community message.
This pass started from clean isolated feature commit
`85a15e52eaa4f6c9d45340056aab3b3206d2ee67`. Canonical origin, feature branch,
worktree isolation and protected release ancestry were verified; remote fetch
completed without changing checkout files. Protected release remains
`9c2994b10e9f263e98a262e87a9bf7a94ee941c5`. The separate push checkout is doing
other work and was not edited. No personal production records were queried.

### Research and recommended behavior

Blocking conventions differ; they are product decisions, not a single mandatory
protocol. [WhatsApp's official explanation](https://faq.whatsapp.com/414631957536067)
retains the existing chat and allows shared-group messages to remain visible.
[Snapchat's official explanation](https://help.snapchat.com/hc/en-us/articles/7012401093396-How-do-I-block-a-friend-on-Snapchat)
says active one-to-one conversations disappear from the blocking person's view,
while shared-group messages can still be seen.
[Signal's official explanation](https://support.signal.org/hc/en-us/articles/360007060072-Block-numbers-usernames-or-groups)
hides the blocked contact's group messages from the blocker but warns that the
blocked contact may still see the blocker's group messages/profile updates.
These sources were read October 7, 2026. None establishes WashedUp's live behavior.

Recommended WashedUp contract, with implementation status kept separate:

- After a confirmed block, hide the private conversation's row, picture, preview
  and row unread count from the blocker's normal inbox. Preserve message records
  for reporting; do not delete another person's history or group history.
- Stop new private contact and notifications in both directions at the server;
  verify existing conversations and direct links as well as new-DM creation.
  A frontend visibility filter alone cannot establish this protection.
- For ordinary shared-chat messages, hide the blocked author's content and avatar
  from the blocker. A quoted/replied-to hidden message can say “Message unavailable”
  without repeating its text or photo. Avoid “Message deleted” unless it really
  was deleted. Group membership and group records must not be silently removed.
- Keep blocking distinct from a global ban. Retain a clear place to manage blocked
  people, and retain an intentional reporting path. Do not announce the block to
  the other person or promise that previously seen information can be recalled.

For uniform ordinary-chat interactions, use the same hold-to-react/action menu,
attached reaction chips, and reply behavior in shared, main-community and topic
messages. [WhatsApp documents holding a message to react](https://faq.whatsapp.com/424198503229937/),
and [Signal documents swipe-to-reply and cancellation in the composer](https://support.signal.org/hc/en-us/articles/6851465208986-Reply-to-a-specific-message).
Announcements/system cards can remain distinct but should have consistent
applicable actions and clear unavailable/read-only states. Main-community nested
replies currently differ from quoted replies elsewhere; moving that history
requires an explicit data-preserving design. This pass does not claim to have
completed that unification.

### Confirmed source gaps and bounded repair

1. Both private-inbox fetch paths built a counterpart's name, image and last
   message without consulting the mutual-block resolver. They now collect DM
   counterpart IDs and call the existing `yours_is_blocked_between` helper through
   `getBlockedWith` before publishing fresh DM rows. Either-direction blocks and
   per-person privacy errors exclude the private row. Named circles/plan previews
   retain their existing semantics; no group is deleted.
2. The block hook invalidated React Query caches, but the Chats list uses its own
   component state and per-account process cache. Those previews now live in a
   small shared cache module. A successful block removes matching private rows
   by account and counterpart ID, including when Chats is unmounted. Mounted
   lists retire earlier reads, repaint the filtered cache and refresh. A dirty
   flag also bypasses the normal next-focus throttle. Stale refreshes and delayed
   realtime sender hydration cannot restore a pre-block preview.
3. Legacy callers without an explicit operation scope ignored returned auth,
   profile-read and profile-update errors. The block hook now checks these errors
   for all callers and rejects missing profiles/accounts. Error paths leave
   previews intact and show failure rather than false success. Existing scoped
   account/visit guards and report payloads remain. Inbox removal happens before
   the existing best-effort report wait.

This is a client repair, not proof that the reported real block failed or that a
new message arrived after it. No block/unblock/report was sent to production,
and no real conversation or image was deleted. Tests use fictional identities.

### Profile discovery and remaining security verification

Source review found limited profile cards reachable from shared chat/member
surfaces, an exact-handle People lookup, and gated individual-profile/DM paths.
The checked-in `get_or_create_dm` migration requires an accepted relationship
and rejects mutual blocks. That is repository intent, not confirmation that the
same function is deployed. It also does not by itself prove that writes into an
already-existing conversation are denied after blocking.

The checked-in original circle message SELECT/INSERT policies rely on joined
membership. Live effective policies, triggers, public-profile visibility and
notification dispatch must be verified together before asserting complete
server-enforced blocking. This pass does not deploy or replace them. A block
record, relationship history, DM creation time and any retained navigation audit
events would be needed to investigate the particular contact; a first name and
an old inbox preview cannot establish how he found the profile. No such personal
record was retrieved or attributed in this pass.

Other limits: warm caches after a block performed on another device are not a
cross-device privacy-sync guarantee; existing private deep-link/header reads,
group avatars, quotes, typing, search and aggregate notification badges were not
converted into a new universal block layer here. The additional privacy lookup
is one parallel RPC per distinct private counterpart; production inbox latency
with a large number of DMs remains unmeasured. Native testing did not exercise
this block flow against real accounts.

### Verification and changed files

- New tests reproduced the unscoped false-success and retained private-preview
  problems against the previous source. Original and candidate results are kept
  separately. One new account-switch fixture initially returned the old person's
  membership for every account; its mock was corrected to return no membership
  for the new viewer, then the final full inventory passed to the stated baseline.
- 17 cases added: six block-hook cases and eleven private-inbox cases. The
  existing twelve block-scope cases were newly included in the wider inventory.
  Direct blocking suites: **29 passing tests**. Existing loading/history/expiry
  suites: **18 passing tests**.
- Final selected inventory: **174 suites, 170 passing suites, 2,510 passing tests,
  11 unchanged baseline failures, zero pending, zero timeouts**. Independent Jest
  processes, at most two concurrently, 60 seconds per suite. The same four
  baseline failing suites are listed earlier in this record.
- TypeScript, auth invariants, diff whitespace and offline iOS JavaScript/Hermes
  export passed. Available Node 24.19 used; pinned Node20.20.1 unavailable. No
  separate lint command is configured. No new simulator performance or real
  multi-client transport measurement is claimed for this continuation.

Every file changed in this continuation:

- `hooks/useBlock.ts`
- `hooks/useChatList.ts`
- `lib/chatListCache.ts`
- `hooks/__tests__/useBlock.scope.test.tsx`
- `hooks/__tests__/useChatList.blocking.test.tsx`
- `docs/chat-full-recheck-2026-10-07.md`

Evidence:
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/block-inbox-20261007/`.
The final summary and per-suite results supersede the intermediate affected-test
directory containing the corrected fixture failure. Comparisons against this
pass's start and the protected release, source snapshots, check logs and test
inventories are retained. The temporary dependency symlink is removed before
commit. These are JavaScript-only, OTA-compatible source changes with no native
dependency/configuration requirement. Existing release gates still apply.
Nothing was merged, pushed, published, deployed or released.


## Private-chat block entry and save continuation — October 7

**Scope:** Liz clarified that the reported blocked person's photo/message stayed
in her private chat or inbox, then authorized fixing it. This continues the
inbox repair at `e2904294535f9c64415fd3b7e249ab2932659437`; it does not identify
how that person discovered Liz, change production records, or claim that the
community-chat presentation has been unified.

Verified the existing isolated worktree and clean starting status, fetched
origin, confirmed `https://github.com/lizwashedup/WashedUp.git`, and confirmed
protected release commit `9c2994b10e9f263e98a262e87a9bf7a94ee941c5` remains the
branch base and protected local release ref. Work remains on
`feature/chat-loading-20261006`. The root instructions, handoff and external
native-build ledger were reviewed. No nested AGENTS.md files apply.

### Implemented app behavior

- An unnamed two-person Circle/private chat must pass the existing mutual
  block RPC before its payload reaches the route. A blocked or unverified
  counterpart returns a neutral unavailable entry: no peer header/photo,
  conversation composer or retained profile/plan action. Named pairs and
  larger groups retain their current classification.
- A confirmed local block retires the viewer's warm Circle query generation
  and in-flight reads. A pre-block result cannot restore the private chat.
  Other accounts' caches remain separate. The prior inbox repair still removes
  the matching preview, photo and row unread count immediately.
- Mini-profile cards check mutual blocking before private/public profile reads
  or mark enrichment. A matching block signal retires an already open card.
  Missing access shows Profile unavailable instead of a synthetic Member card.
- Only explicit boolean false permits the mutual-block helper to reveal a
  candidate. Returned errors, thrown failures and malformed/null results hide
  that candidate. This helper is shared by other existing privacy reads.
- A new block requires a matching profile update receipt containing the target
  and all previously read block IDs. The update compares the old array before
  saving, so a concurrent edit cannot silently replace another device's block.
  A conflict or uncertain result reports an error and permits an explicit retry;
  it does not claim success. Retrying first rereads the actual saved list.
- Auth/profile/write waits are bounded to 12 seconds each. Unmounted and duplicate
  unscoped confirmations are rejected. Optional reporting still dispatches its
  existing payload, but its response no longer stalls confirmed block completion.
  Cache invalidations occur before privacy observers can retire the originating
  chat scope; stale completion/navigation callbacks remain suppressed.

The bottom-tab unread query currently counts joined-event notifications only;
it does not count private Circle notifications. No global badge change or
notification-record mutation was made in this pass.

### Server boundary prepared, not deployed

The checked-in legacy Circle message policies require membership, but do not
recheck a mutual block on an existing DM. The local fixture first demonstrates
that gap. The new SQL is deliberately under `docs/database/review-only/`,
outside the automatic migration inventory.

It adds a current-caller membership/block helper and restrictive SELECT,
INSERT and UPDATE policies for private messages and their reactions. Existing
permissive policies cannot bypass that additional boundary. Both block stores
and directions are honored. History remains stored. Existing named-group,
larger-group and event behavior is retained by this boundary.

The disposable PostgreSQL 17.11 fixture passed 99 assertions, including the two
pre-fix demonstrations, all block-store/direction/viewer combinations, ordinary
sends/reactions, blocked reads/sends/edits/reactions, moving existing content
into a blocked DM, outsider denial, retained sender checks, anonymous helper
grants, group preservation and stale-array write rejection. It imports the
canonical checked-in mutual-block helper. The runner accepts only a local
PostgreSQL binary directory, creates an empty database, disables TCP, uses a
private Unix socket, then stops and removes its own database. No project URL,
production credential, external service or live data is used.

Before any promotion, the effective live RLS, RPC definitions/grants, privileged
message writers, Realtime behavior and push eligibility must be checked.
SECURITY DEFINER RPCs/service-role operations can bypass table RLS; this candidate
does not claim to gate all such paths, erase cached remote images, or restrict
all profile/Storage endpoints. No existing RPC body was overwritten from an
unverified historical migration. Production enforcement is therefore **not yet
established** by these local checks.

### Verification on this continuation

Evidence directory:
`/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/block-entry-20261007/`.

- Final distinct selected chat/adjacent inventory: **176 suites, 172 passing
  suites, 2,557 passing tests, 11 unchanged baseline failures, zero pending,
  zero timeouts**. Each suite ran separately, with at most two concurrently.
  The final changed block/route suites replace their earlier results in the
  summary; repeat executions are not added together. The four known failing
  files and their causes remain listed above.
- Focused tests cover block receipts, concurrent-list comparison, stalled
  reporting/reads/writes, duplicate/unmounted confirmations, query-generation
  retirement, late privacy results, open-profile removal and neutral route
  behavior with retained actions rejected.
- TypeScript passed; auth invariants passed; offline iOS JavaScript/Hermes
  export passed; diff whitespace checks passed. No standalone lint command
  is configured. Used existing dependencies and Node 24.19, not the pinned
  Node 20.20.1 environment.
- Required legacy `qa/guinea-verify-washedup.sh` was attempted: no-cloud-build
  guard, seven paid-flow Node assertions and 131 ticketing Jest tests passed,
  then the runner stopped because `deno` is unavailable. That complete legacy
  pipeline is not represented as passing. These extra checks are not folded
  into the selected inventory count above.
- No matching-device, simulator, production RLS or new multi-client Realtime
  run was performed for this continuation. Earlier simulator/transport results
  elsewhere in this document remain separately scoped.

### Every file changed in this continuation

| File | Change |
| --- | --- |
| `hooks/useBlock.ts` | Exact save receipt, concurrent-array guard, bounded waits, nonblocking report and lifecycle ordering |
| `hooks/useCircle.ts` | Private entry mutual-block gate and retirement of warm/in-flight data |
| `components/MiniProfileCard.tsx` | Privacy preflight, open-card retirement and unavailable state |
| `lib/blocking.ts` | Explicit unblocked receipt; failed/unknown checks hide the candidate |
| `lib/chatListCache.ts` | Privacy notifications include the blocked person's ID |
| `hooks/__tests__/useBlock.scope.test.tsx` | Save, timeout, reporting, lifecycle and invalidation regressions |
| `hooks/__tests__/useCircle.account.test.tsx` | Mutual block, warm-cache, delayed-result and group classification regressions |
| `components/__tests__/MiniProfileCard.lifetime.test.tsx` | Privacy preflight and open-card regressions |
| `components/chat/__tests__/CircleChatMenuLifetime.test.tsx` | Unavailable private entry and retired route actions |
| `lib/__tests__/blocking.test.ts` | Mutual-block helper failure and receipt cases |
| `docs/database/review-only/20261007120000_private_chat_block_boundary.sql` | Undeployed restrictive message/reaction policy candidate |
| `supabase/tests/contracts/20261007_private_chat_block_fixture.sql` | Empty-database-only synthetic schema and data |
| `scripts/db-contracts/test-private-chat-blocks.py` | Disposable, socket-only PostgreSQL test runner |
| `docs/chat-full-recheck-2026-10-07.md` | This report |

The final evidence also contains `continuation.diff`, `protected-base.diff` and
`protected-base-files.txt` for the complete accumulated feature comparison with
the protected release. The full branch includes prior chat reliability work;
this turn's changed files are the fourteen above.

### Remaining gates and delivery classification

App changes are JavaScript/TypeScript-only and **OTA-compatible in principle**
with the preserved Build 51 native/dependency contract. They still require the
normal reviewed integration and guarded release process. The SQL is a separate
backend candidate requiring live compatibility review and authorized deployment;
it cannot be delivered through an app OTA. No new native dependency or native
configuration was added, so the native-build ledger has no new item.

The app remains unpublished. Warm state on another device does not receive an
immediate local block signal; fresh entry/refresh and server enforcement remain
necessary. A mutual-block RPC round trip is added to private entry and mini-profile
opening; matching-device latency is unmeasured. Broader shared-group quote,
reaction/typing identity presentation and a block-management/unblock screen are
not completed by this private-chat repair. No evidence establishes the specific
person's original profile-discovery route or any unauthorized access.

After an approved matching test version is available, test with a dedicated
second account: open a private chat, block it, confirm the inbox/photo disappears,
reopen an old chat link, restart the app, and attempt a new message/reaction from
the other account after the backend candidate has been reviewed and deployed.
These production-independent preparations do not substitute for that acceptance
check. No merge, push, OTA, build, deploy, notification send or production change
was performed.
