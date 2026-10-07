# Chat responsiveness and recovery — second audit, October 7, 2026

This continues the isolated chat work at `332a8a99f966f8da951261814773414693785d8b`. It completes another bounded implementation and verification pass. It does not establish WhatsApp parity or production delivery performance. The immediate bulk-input simulator case remains unresolved; do not mark the candidate release-ready on this evidence alone.

## Changes and practical effect

- Main community messages now appear locally with **Sending**, **Sent**, or **Not confirmed** feedback. A confirmed local row remains until authoritative history arrives; matching UUIDs replace it once. Equal text with different IDs stays distinct. Edits do not create a second bubble. Account/visit changes and later authoritative deletion cannot revive an old local confirmation.
- Main community history can display privacy-checked message content while names, photos, reactions and reply counts finish loading. Block filtering precedes this early paint. Partial rows cannot use message mutation/reply/reaction actions; enrichment errors retain a retry state. Mapped main rooms validate the authoritative references and current account before early display. Initial Intros and notification-anchor reads retain their existing complete-reader path.
- Fresh text sends separate the original durable attempt from the next draft **before** waiting for storage. Transport still waits for the durable write. Identical next text survives confirmation and serialized reload. Reply validation cannot clear an intervening draft revision, even if its words match. Explicit retry keeps the same original UUID. Failed sends remain in recovery instead of being mixed back into newer typing.
- The three composers request native clearing at that same handoff. Mention suggestions for the next draft are no longer cleared by an earlier confirmation. Existing edit, target-validation and receipt protections remain.
- Added bounded, memory-only development timing samples for community identity/history/privacy/metadata, main text readiness/layout, and shared/main/topic send confirmation. They contain no text, IDs, network reporting or disk storage; production collection is disabled.

No Stream, native dependency, native configuration, schema, migration, notification/auth/account-lifecycle or creator/Hangouts change was introduced. This remains a single durable unresolved original plus the next draft, **not a durable multi-message offline outbox**. A general outbox needs its own idempotency, ordering, expiry and attachment design and integration verification.

## Verification

The broad pass ran **159 suites in independent Jest processes**, two at a time, with normal exit and a 60-second limit per suite: **2,335 passed, 3 failed, zero pending**. The last reply-validation refinement then reran all five affected draft/shared/main/topic screen suites: **231 passed**, adding two regressions. The resulting distinct test inventory is **2,337 passed, 3 failed across 159 suites**; repeated executions are not added together.

The three failures are the same baseline failures already reproduced at the protected release in the preceding audit: one in `lib/__tests__/communityPageRead.test.ts` and two in `lib/__tests__/setupCommunityLanding.test.ts`. They are not called green or repaired as unrelated scope. The previous report retains the before/after baseline evidence.

Additional checks: final TypeScript `tsc --noEmit` passed; source-only auth-invariant script passed; `git diff --check` passed; offline local iOS JavaScript/Hermes export passed. Export used disabled dotenv/telemetry and Sentry auto-upload; it created no native build or OTA. No configured lint command/config was available, so standalone lint is not claimed. The available Node runtime was 24.19 rather than the repository's intended Node 20.

Focused regressions cover pending/confirmed/echo deduplication, deletion after echo, scope retirement, slow and failed storage, identical newer text after reload, typing during reply validation, early history before metadata, block privacy, account retirement before early display, mapped source mismatch, query cancellation and withholding incomplete message actions. Existing chat/adjacent tests cover startup, sign-in, onboarding, account ownership, notification entry, editing, media, keyboard adapters, repeated room visits and long history; this is not the full repository suite or live backend integration.

## Native simulator evidence and limits

Used the existing **com.washedup.localdev 1.0.6/build 44** app on iPhone 17e / iOS 26.4. Current feature source is imported into a local fixture, including actual main and topic screens as well as shared ChatThread and keyboard/composer components. No production app was launched for this pass, no native build installed, and no production message sent. The full Device Hub window was restored so keyboard/composer screenshots could be inspected.

Observed with fixture revision r3:

- Main text appeared with placeholder names before the injected slow metadata completed, then names/actions populated.
- Main pending feedback appeared immediately; successful acknowledgment became one authoritative bubble. Next-draft content survived acknowledgment and an app-process restart through actual native AsyncStorage.
- With an injected 200 ms history delay, local text readiness was **207 ms** and first list layout **244 ms**. Three sends with a deliberate 3,000 ms transport delay measured **3,063 / 3,077 / 3,055 ms** to confirmation. These are synthetic-path diagnostics, not cold app launch, production latency, device-to-device receipt, p95 or a before/after benchmark.
- Actual topic screen loaded, sent, retained an unconfirmed original after a synthetic failure, and explicitly retried it to one visible saved bubble. The composer and recovery controls remained accessible.
- A 500-row topic fixture rendered its latest messages and the composer stayed above the native keyboard. Device Hub wheel/drag attempts did not establish reliable native older-position/fling evidence, so smooth scrolling, frame rate and anchor retention are **not certified** by those attempts.
- Send followed immediately by an actual on-screen key cleared the old native input and retained the new character. However, immediate bulk `typeText` automation reproduced old-text concatenation in main and topic even after a clean bundle restart. Normal isolated clear worked. **This remains an unresolved rapid-input case**, not a dismissed automation artifact or a passing test. Do not strip a text prefix heuristically: that could delete intentional words.

The final two reply-validation regressions were added after r3 native observations; they passed the five-suite rerun and final export. The saved r4 fixture points to final source and is served on localhost:8847, but final r4 native interaction is not claimed. The currently open preview may still show r3 until explicitly reloaded. No user's visible draft should be discarded to force that reload.

Fixture services are synthetic: original shared/topic transport hooks, privacy backend, server history, permissions, media and navigation are substituted. Actual native AsyncStorage is used. Main mapped/native nested replies are not modeled; their source adapters have unit tests. Topic fixture location/reply mapping is incomplete. No real two-account delivery, recipient receipt, push wake-up, full Build 51 native parity, Android, device cold-start benchmark, sustained native memory/CPU soak or physical-device validation was established. No encryption or delivery guarantees beyond implemented receipts are asserted.

The React Native [TextInput documentation](https://reactnative.dev/docs/textinput) and the upstream [clearing/event-count discussion](https://github.com/react-native-community/discussions-and-proposals/discussions/803) are relevant references for the remaining native-input investigation; they do not prove the root cause on this binary. No native force-clear patch or dependency upgrade was added under the build hold.

## Review and next device test

The saved verification pack is `/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007`. It contains the reusable fixture, source hashes, full suite logs/reports, final focused results, TypeScript/auth/export evidence and comparison files. See `native-fixture/README.md` for exact launch boundaries. The fixture operates on fictional users and messages only; it is not the live WashedUp app.

Liz can review the local preview now. Before live use, the exact candidate needs an approved test installation with two consenting test accounts. A short realistic check should cover: main community, topic, Plan and Circle/DM; rapid send-and-continue-typing (including the exact same text twice); switching away/back; keyboard open/close while reading older messages; connection interruption and explicit recovery; and photo/voice/reply/edit behavior. Record the room, action, phone/OS and whether text disappeared, duplicated or stayed pending. Liz does not need to diagnose code. The highest-priority open check is the native rapid-input case; then real recipient delivery and reconnect behavior. A long-duration soak and Android coverage follow once a matching test environment is available.

## Isolation and comparison

Feature branch: `feature/chat-loading-20261006`. Base remains exactly `9c2994b10e9f263e98a262e87a9bf7a94ee941c5`; canonical origin remains `https://github.com/lizwashedup/WashedUp.git`. No merge, push, deployment, OTA, native build, production mutation or notification was performed by this task.

During the final check, the separate push-repair checkout had independently moved to local `main` at `d7bdb9a8a4f1e648bd2309c10db8408e5062ff99` (“Merge Build 51 push registration repair”). Its tree is identical to the protected release commit and its working tree is clean. The protected release branch itself still points at the exact protected commit. This task did not perform that merge or change its own base.

All changes in this pass are JavaScript/TypeScript and documentation and need no new native dependency/build. They are structurally OTA-compatible with the protected base, subject to integration and validation; **no publication is authorized**. Native platform fixes, if later needed for the open input case, require a separately documented future native build. No native patch has been prepared here.

## Files changed in this pass

- `app/community-thread/[id].tsx`
- `app/community-topic/[id].tsx`
- `components/chat/ChatThread.tsx`
- `components/chat/__tests__/ChatThreadEntryLifetime.test.tsx`
- `components/chat/__tests__/CommunityMainEntryLifetime.test.tsx`
- `components/chat/__tests__/CommunityMainQueryIsolation.test.tsx`
- `components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx`
- `hooks/__tests__/useChatComposerDraft.prepare.test.tsx`
- `hooks/__tests__/useCommunityLocalDelivery.test.tsx`
- `hooks/__tests__/useTopicComposerDraft.test.tsx`
- `hooks/useChatComposerDraft.ts`
- `hooks/useCommunityLocalDelivery.ts`
- `hooks/useTopicComposerDraft.ts`
- `lib/__tests__/chatPerformance.test.ts`
- `lib/__tests__/communityOperationScope.test.ts`
- `lib/__tests__/communityRoomHistory.test.ts`
- `lib/chatComposerDraft.ts`
- `lib/chatPerformance.ts`
- `lib/communityChat.ts`
- `lib/communityRoomHistory.ts`
- `lib/topicComposerDraft.ts`
- `docs/chat-phase2-audit-2026-10-07.md`
- `docs/chat-reliability-2026-10-06.md`

## Follow-up: draft recovery errors — October 7

Continued from `8801f00f2f4f02a73cacc15f5f413d8d0f70b106` on the same isolated feature branch and exact protected release base.

Two confirmed races are repaired in the shared and community draft hooks:

- A delayed saved-draft read could replace typing entered after that read started, or restore an unresolved attempt after its send had already been confirmed. Reads and read failures now apply only if the draft revision has not advanced. Account/visit and read-generation guards still apply.
- A failed older confirmation-cleanup write could set the composer to an error state after a newer draft write succeeded. The existing per-write revision guard now owns that error state; confirmation cleanup no longer overrides it. A failure of the latest write still exposes recovery, and transport still waits for durable attempt storage.

Eight new regression cases were run against the previous committed hooks: all eight failed (27 existing tests passed). With the fixes, the focused surrounding inventory passed **501 tests in 15 independent suites**, including main/topic/shared screen lifetimes, draft storage/preparation, local delivery, topic mutation/refresh/Intros, composer accessibility and media. This is this follow-up's run count, not an additional full-repository result. TypeScript, auth invariants, `git diff --check`, and offline iOS JavaScript/Hermes export also passed. Export: `/tmp/washedup-chat-draft-races-export-20261007`. No standalone lint configuration is available. The requested `sh qa/guinea-verify-washedup.sh` was attempted before dependency linking: no-cloud-build and seven paid-flow static tests passed, then it stopped at `jest: command not found`; the aggregate private-database/web pipeline is not claimed complete. Focused tests subsequently used the existing dependency directory through a temporary symlink. The three unrelated baseline failures from the preceding audit remain unmodified.

Native diagnosis used the same existing local development binary, fictional fixture and real native AsyncStorage. Revision r5 added a minimal controlled multiline input probe. One immediate send/type probe kept only the new text; the actual topic screen reproduced old/new text mixing. Another traced topic run cleared correctly; a following bulk-input attempt emitted no native change events. This evidence does **not** establish whether the remaining intermittent case is in React Native, application update timing, or Device Hub automation. No prefix-stripping, forced event-count override, input remount, native patch or dependency upgrade was added. Temporary message-content tracing was removed from application source. The reusable fixture retains the minimal probe; r6 imports the repaired hooks. Real rapid typing, scrolling and two-account delivery still need a matching-device check; these draft race fixes do not certify the unresolved native case.

Files changed in this follow-up:

- `hooks/useChatComposerDraft.ts`
- `hooks/useTopicComposerDraft.ts`
- `hooks/__tests__/useChatComposerDraft.test.tsx`
- `hooks/__tests__/useTopicComposerDraft.test.tsx`
- `docs/chat-phase2-audit-2026-10-07.md`

External verification assets were updated under `/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007`: the fixture entry screen/probe, local Metro logs, before/after regression logs and per-suite JSON/logs in `evidence/draft-race-regression`. These are local test assets, not application release files. No production data or service state was changed. The code changes require no native build and are structurally OTA-compatible; no merge, deployment, publication or release is authorized or performed.

## Follow-up: nested community replies — October 7

Continued from `64aea04972d5f5bafe005d47a565cab4e7389a4c`. The nested reply composer still used the older send handoff. It now separates a fresh original reply from the next editable draft after parent validation and before waiting for durable storage, using the same existing hook option as the main/topic/shared composers. Transport continues to await storage, and retry keeps the original UUID. Original text remains visible in recovery on failure. Confirmation no longer dismisses mention suggestions belonging to the next reply.

Four new regression executions (two cases each for a message and broadcast) reproduce identical next-text loss and next-draft mention dismissal against the previous hook. With the fix, **120 tests passed across four focused suites**, including companion lifetime, topic draft storage/hook and composer presentation. Existing timeout/failure assertions now check the original recovery text separately from the blank next-draft field; the account-switch test also proves later typing survives both old-visit and current confirmation. TypeScript, auth invariants, local offline iOS JavaScript/Hermes export and diff whitespace checks passed. Export: `/tmp/washedup-chat-reply-drafts-export-20261007`. No new native device interaction or full repository run is claimed for this change. The aggregate pipeline/lint limitations above still apply.

Files changed: `hooks/useCommunityReplyComposer.ts`, `components/communities/__tests__/CommunityCompanionLifetime.test.tsx`, and this audit. Evidence is saved as `evidence/reply-*.log` in the verification pack. This is an isolated JavaScript change requiring no native dependency/build; nothing was released. The open r6 fixture predates this nested-reply follow-up and does not model native nested replies, so it must not be treated as device validation of this fix.

Remaining uncertainty is unchanged: immediate native send-and-type timing, sustained keyboard/scroll behavior, physical-device cold starts, real two-account delivery/reconnect/background operation, and Android. Existing automated evidence is meaningful but does not establish end-to-end WhatsApp parity. The single unresolved original plus next draft remains distinct from a general multi-message offline outbox. No native workaround or broader backend design is asserted complete.

## Follow-up: real local multi-client delivery and reconnect — October 7

Continued from `eeeec2bdb0906c6c58c248591c1f2d6350629df1`. Two physical phones are
not required for the transport checks completed in this follow-up. A separate
local Supabase native runtime ran real Auth, PostgreSQL, PostgREST and Realtime
with two independently authenticated members and a third unrelated account.
The server and fictional data were isolated outside the app repository. The
harness restricts HTTP and WebSocket requests to its explicit loopback endpoint
and verifies a local fixture marker before creating accounts or data.

The initial real-service test reproduced an SDK close/rejoin race: after the
last channel leaves, `connect()` ignores a new attempt while the previous socket
is still closing. Main community subscriptions already waited for this state;
shared and topic subscriptions did not. They now use the same cancellable wait,
and PostgreSQL data channels receive unique names per visit so a returning room
does not reuse a channel still leaving. Retired visits cannot join later.
Broadcast/presence names and typing behavior were not changed. Main community
subscriptions now reuse the extracted helper while keeping their existing names.

Evidence and checks:

- The unguarded real SDK run timed out at receiver reconnect; its report is
  `evidence/two-client-reconnect-before.json` in the verification pack.
- Three new shared/topic hook regression cases all failed against their previous
  committed implementations. With the repair, **570 tests passed across 12
  independent chat suites**, including shared/topic refresh and mutations,
  entry/companion lifetimes, ownership, anchors and community subscriptions.
  The earlier focused 106-test run overlaps this count; it is not additive.
- The final local integration run passed **all 10 scenarios**, ending with 78
  distinct messages: two-way live delivery, Unicode/multiline text, 40 concurrent
  sends, recovery from a deliberately lost committed-insert response, same-ID
  retry without duplicate rows/events, 20-message disconnected catch-up, six
  reconnect cycles, outsider read/receive/insert rejection, sender impersonation
  rejection, and archived-topic send rejection with retained history.
- TypeScript, auth invariants, diff whitespace checks and offline local iOS
  JavaScript/Hermes export passed. Export is at
  `/tmp/washedup-chat-reconnect-export-20261007`. No native build or OTA was made.
  The prior aggregate-pipeline and missing standalone-lint limitations still
  apply; the full repository suite was not rerun or claimed green.

Reproduction instructions are in `scripts/chat-lab/README.md`. CLI 2.120.0 was
downloaded from the official release and its SHA256 matched the release asset
digest; it was installed only inside the external lab directory, not globally.
Supabase documents this experimental [native local runtime](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes).
The lab uses the existing installed SDK and `ws`, with Node 24 TypeScript
stripping. No app package, lockfile, native configuration, production secret or
release configuration changed. The lab service is stopped after verification;
private local credentials and fictional data remain outside Git for reuse.

These are real service/SDK checks using the app's receipt, merge and subscription
helpers, **not the complete running app with two native devices**. The scoped
topic-policy fixture derives from the repository's September 3 policy snapshot;
it does not prove today's production schema or policy parity. The harness
explicitly fetches missed history; app hook tests separately cover refresh
ownership. Two local round-trip samples are diagnostics, not production latency
or a cold-open benchmark. This bounded run is not a long-duration soak.

The earlier lack of real multi-account transport evidence is now partially
addressed by this lab. Still open: the intermittent native send-and-type case,
physical keyboard/scroll performance, exact Build 51 app parity, physical cold
starts, actual app-to-app background delivery and push, media transfer under
poor connectivity, and Android. The current r6 native preview predates this
follow-up and has simulated transport. It is not device validation of these
changes. Apple's [Simulator testing guidance](https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/TestingontheiOSSimulator/TestingontheiOSSimulator.html)
also distinguishes Mac-backed simulation from device performance.

Files changed in this follow-up:

- `hooks/useChat.ts`
- `hooks/useTopicChat.ts`
- `hooks/__tests__/useChat.refresh.test.tsx`
- `hooks/__tests__/useTopicChat.refresh.test.tsx`
- `lib/communityConversationRealtime.ts`
- `lib/chatRealtimeSubscription.ts`
- `lib/__tests__/chatRealtimeSubscription.test.ts`
- `scripts/chat-lab/run.mjs`
- `scripts/chat-lab/schema.sql`
- `scripts/chat-lab/README.md`
- `docs/chat-phase2-audit-2026-10-07.md`

Feature branch remains `feature/chat-loading-20261006`, based on protected commit
`9c2994b10e9f263e98a262e87a9bf7a94ee941c5`. The repair is JavaScript-only and
structurally OTA-compatible; no future native build is required by this change.
No merge, push, deployment, production mutation, notification, build or release
was performed. Final branch/base comparison and file inventory are saved in
`evidence/two-client-final/` in the external verification pack.
