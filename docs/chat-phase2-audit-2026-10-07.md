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
