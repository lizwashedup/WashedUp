# WashedUp chat: full scoped recheck — October 7, 2026

## Result

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
