# WashedUp chat: full scoped recheck — October 7, 2026

Latest continuation: **2,454 passing tests, 11 unchanged baseline failures,
170 suites**. The scroll-recheck section at the end records drag ownership,
bounded message jumps, and the limited r8 native preview checks. Earlier
transport and device results remain separately identified.

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
