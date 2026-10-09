# Chat reliability: first isolated repair

Date: October 6, 2026 (America/Los_Angeles).

Latest status: [October 7 repair and audit](chat-audit-2026-10-07.md). That report supersedes the incremental file lists and final-check counts below; earlier entries remain historical evidence.

## Founder direction and scope

Liz wants dependable, consistent everyday messaging comparable to WhatsApp: prompt conversation opening, reliable sending, consistent replies/reactions, and continuity when returning. She reports lag and errors and dislikes main community chats feeling different from other conversations. This is the next product priority. Hangouts follow chat; simplifying creation and approval follows Hangouts.

Queued creation direction: a shared + entry with Create a plan as the default, short explanations of plans/events/communities, draft creation before approval, explicit pending/approved feedback, and an optional organization home for repeat event creators. This patch does not implement that flow.

Protected base: `9c2994b10e9f263e98a262e87a9bf7a94ee941c5` from `https://github.com/lizwashedup/WashedUp.git`. Feature branch: `feature/chat-loading-20261006`. The feature has its own worktree. PR #14 and its release checkout are not edited or merged.

## Reproduced defects and changes

1. Returning to the legacy main community chat did not request missed history; only the mapped-room variant had that catch-up path. Both now refresh through the existing authorized reader on focus and background-to-foreground return.
2. Neither variant explicitly refreshed history when the existing connectivity signal recovered. A focused, foreground, admitted conversation now catches up when that signal changes from offline to online.
3. Overlapping return signals could cancel and restart an active refresh. The new triggers reuse an in-flight query instead. Existing visible messages and composer drafts remain in place.
4. A 12-second history deadline inherited the query client's automatic retries, prolonging initial loading. Deadline failures now expose the existing retry control after one attempt. Other read errors retain bounded retries; notification anchors retain no automatic retries.

Only the main community screen's refresh/retry behavior changes. No message-table consolidation, appearance redesign, send/retry-write changes, notification changes, authentication changes, permission changes, native dependencies, or production actions.

## Verification

- Counterfactual: ran the final 25-case community screen suite against the exact protected version of that screen, using the isolated feature checkout only. Eight cases failed and 17 passed. Restored the feature screen byte-for-byte afterward. The baseline run used force-exit after reporting because its intentionally failed pending-read cases leave waits outstanding.
- Feature verification: 182 tests passed across six suites, with normal process exit: CommunityMainQueryIsolation, communityConversationRealtime, communityOperationScope, useChat.refresh, useTopicChat.refresh, and PlanChatLoading.
- The community suite covers both legacy and mapped history, return/reconnect, loaded history and draft preservation, overlapping refreshes, timeout and explicit recovery, removed/offscreen/background users, account changes and stale responses, and existing read acknowledgements/reactions. Its native safe-area mock and multi-hook navigation-focus fixture were updated to match the actual screen.
- TypeScript `tsc --noEmit --pretty false`: passed.
- Local auth/startup-related invariant script `scripts/release/check-auth-invariants.mjs`: passed. This reads source; it does not execute its referenced production SQL.
- Local offline iOS JavaScript/Hermes export: passed, output `/tmp/washedup-chat-review-export-20261006`. No signed app, installation, store build, OTA publication, or Sentry upload was performed.
- `git diff --check`: passed. No configured standalone lint command was found; none was invented or installed. The full legacy test inventory was not run or represented as passing.

## Compatibility and limits

This is a JavaScript-only change, structurally OTA-compatible with the protected base; normal integration and release checks still apply. No new native-build ledger item is needed. Nothing is released or authorized for release by this verification.

These tests establish behavior in controlled local conditions. They do not establish real-device cold-open timing, scroll/keyboard smoothness, cross-device delivery latency, or WhatsApp feature parity. The existing connectivity detector polls, so this patch refreshes on detected recovery rather than promising instantaneous network awareness. Catch-up continues to use existing infinite-query history, including loaded pages; it is not a history-performance redesign.

## Remaining chat work

Next investigation: measure cold opening, warm return, send confirmation and incoming-message latency independently on an approved test installation. Distinguish account verification, history, secondary metadata and rendering time before changing those paths. Preserve Build 51 authentication and push work.

Then make main-community interaction consistent with other conversations, especially replies, pending-send feedback, long-press actions, keyboard and scroll behavior. Main conversations currently use their own stream/reply panel, whereas plans/Circles/DMs share ChatThread. Consistent interaction does not require moving existing private messages to a different table. No such migration or replacement engine is part of this patch.

Physical-device validation and additional targeted repairs remain outstanding. The user's prohibition on new app builds, OTA publication, deployments and production changes remains in force.

## October 6 follow-up: latency, keyboard, scrolling, and repeated use

Application source under test remains commit `d6e3b7857e0ef0813aa832be4cb63abb50d3389d`. This follow-up adds tests and this evidence record; no additional application behavior is changed.

### Executed automated checks

252 tests passed across seven suites, with normal process exit: ChatKeyboard.adapter, ChatThreadComposerAccessibility, ChatThreadEntryLifetime, useChat.refresh, useTopicChat.mutations, useChatList.loading, and PlanChatLoading. TypeScript passed. Six new cases provide repeat-use and controlled-delay coverage:

- 40 event-chat transitions and 40 Circle-chat transitions. Every departed realtime channel is removed; retained callbacks cannot add messages into the next room; final unmount removes the final channel.
- 40 keyboard adapter mounts, each with three opening/closing and attachment-panel handoffs: 120 cycles total. Composer/history translations stay aligned, settled reservations reset, and all 120 event listeners are removed once. This checks listener lifecycle and geometry calculations, not native animation frame rate or total application memory leaks.
- Two initial-history cases (event/Circle) inject a 200 ms history response, 100 ms privacy response, and 5,000 ms optional profile response. Text becomes available when required reads complete, before profile enrichment. These are virtual-clock inputs, **not measured phone or production latency**.
- A text send with a synthetic 3,000 ms acknowledgement shows its pending bubble before confirmation, reconciles it to one confirmed UUID, and does not duplicate it when the realtime insert follows.

Existing passing cases additionally cover scrolling away from the live edge, unread counts excluding older pages and own messages, maintaining history while refreshing, keyboard opening while reading old messages, attachment-panel handoff, duplicate send taps, newer typing while an earlier send resolves, failed-send recovery, media deadlines, account/room changes, and read-only transitions.

Commands used the existing Node runtime with `node node_modules/jest/bin/jest.js --runInBand --ci --runTestsByPath` and the seven suite paths above, plus `node node_modules/typescript/bin/tsc --noEmit --pretty false`. No standalone lint command is configured. No integration/backend deployment or new native build was run. Logs: `/tmp/washedup-chat-final-qa-tests.log` and `/tmp/washedup-chat-qa-typecheck.log`.

### Simulator status and source identity

The booted device is iPhone 17e, iOS 26.4, UUID `2FCFB3F5-F89D-4D12-8421-A1D216204916`. Two installations are present: `com.washedup.app` (1.0.7/build 51) and `com.washedup.localdev` (1.0.6/build 44). The localdev container has Expo remote updates disabled and contains keyboard-controller symbols. Its old version label is not proof of native parity with Build 51.

Launching localdev initially showed an older Local QA conversation. **That screen was rejected as current-feature evidence.** Prepared a separate localhost fixture that imports ChatThread and ChatKeyboard directly from this feature worktree and displays `Current d6e3b785 · Local only`. Expo produced its iOS/Hermes development bundle successfully (HTTP 200; 14,690,505 bytes). This is JavaScript bundling, not a new iOS build. Actual native module compatibility is still unverified until it renders.

The simulator reached Safari's “Open this page in WashedUp?” confirmation for the explicit localhost development-client URL. The computer-use tool returned `noWindowsAvailable` when clicking Open, including after reacquiring and raising the device window. A keyboard confirmation did not advance it. Requested one manual Open click; current-source native render, gesture exercise, cold-open timing, and a native soak test remain **pending**. No older screenshot or compilation result is counted as native success.

Candidate saved for continuation at `/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/chat-current-2026-10-06/`; its README and source-proof.json document exact imports, hashes, containment, startup, and limitations. Active staging: `/private/tmp/washedup-chat-current-20261006`, localhost port 8846. Cases include 500 synthetic messages, deliberately slow loading/sending, empty, failure/retry and closed chat. Transport/auth/profile header/media/permissions are substitutes; the fixture does not exercise the main-community/topic screens or app startup. Production service timings and cross-device delivery remain unmeasured.

### Concrete remaining investigation

Main community `getCommunityBroadcasts` still awaits reaction, reply-count and profile enrichment before returning history. Its send path also differs from the shared optimistic-message path. These are code-observed differences worth profiling; this follow-up does not establish that either is the cause of all reported lag. Next native checks must cover main community and topic as well as shared chats, then a physical phone and an isolated backend test environment for actual transport latency.

### Changed files and protected comparison

Across this feature branch relative to the protected base, the only files changed are:

1. `app/community-thread/[id].tsx` — previous focused refresh/deadline repair.
2. `components/chat/__tests__/CommunityMainQueryIsolation.test.tsx` — previous focused regression coverage.
3. `components/keyboard/__tests__/ChatKeyboard.adapter.test.tsx` — repeated keyboard lifecycle test.
4. `hooks/__tests__/useChat.refresh.test.tsx` — repeated visit, slow enrichment and send acknowledgement tests.
5. `docs/chat-reliability-2026-10-06.md` — this review record.

The two test-file updates and documentation changes do not alter the application bundle. The existing feature repair remains JavaScript-only and structurally OTA-compatible with the protected base; nothing is published. No native dependency/configuration change or native-build ledger addition is required. PR #14 and the protected release branch remain untouched.


## October 6 later simulator observation

Liz accepted the Safari Open dialog. The existing localdev development launcher then connected manually to `http://127.0.0.1:8846`. Verified the actual `Current d6e3b785 · Local only · Mona loaded` banner. The isolated harness needed its own `SplashScreen.hideAsync()` because it bypasses app startup; this was corrected only in the external fixture, then localdev was closed/relaunched through simulator UI. No app startup source or native configuration changed.

Observed native shared ChatThread rendering, local text send and cleared input, software keyboard/composer placement, synthetic delayed loading and sending, a 500-message history, dragging toward older messages, and the return-to-latest control. A simulated failed send retained its original text and exposed check/retry controls. Actual retry completion was not validated because the fixture receipt checker is a stub; it must be improved first. Main community/topic native tests, measured cold-open/frame timings, long-duration soak, actual network delivery and physical-device validation remain open.

One interaction to investigate: typing immediately after Send in the slow fixture retained the original text alongside subsequent typing after the first message appeared. Source has explicit protection for text typed during draft preparation. Reproduce with a focused actual-composer test before deciding whether to change that behavior; distinguish UI automation timing and fixture effects from a production defect. Existing 252 automated checks remain the recorded result, not proof of complete chat quality.

This continuation changes only this repository evidence file and the separately saved local fixture. Feature application code remains identical to d6e3b785. No release or production changes.


## October 6: remove redundant text-send confirmation

The shared Plan/Circle/DM composer previously waited for `sendMessage` to confirm the saved row, then performed another account-scoped read of that message before releasing the send lock. A stalled or failed second read could leave an already-saved message marked unconfirmed. This patch validates the full text intent in the original insert/recovery receipt (UUID, conversation, account, content, user-message type, no image, reply target and mention identity) and uses that validated acknowledgement directly. It eliminates one redundant receipt-read phase on confirmed non-edit text sends. It does not claim a measured production millisecond or percentage improvement.

Unknown deliveries still use the existing bounded lookup, retained original UUID and explicit check/retry. Edits keep their existing extra verification. Media receipt behavior, database schema, auth, notifications, release configuration and native dependencies are unchanged. Account/room retirement is checked before the receipt can finish the composer.

### Verification of this change

- Before implementation, nine new regression cases failed: the redundant composer read and eight wrong-receipt fields. The remaining 173 cases in those two suites passed. After implementation, all these cases pass.
- Final focused run: **327 tests passed in 10 suites**, normal exit. Suites: useChat.ownership, useChat.refresh, useChat.anchor, ChatThreadEntryLifetime, ChatThreadComposerMedia, ChatThreadComposerAccessibility, useChatComposerDraft, useChatComposerDraft.prepare, chatComposerDraft, ChatKeyboard.adapter. Includes interrupted acknowledgement recovery, retained reply/mention identities, stale accounts/rooms, newer typing, duplicate taps, history anchoring and keyboard lifecycle. Receipt fixtures now supply the complete selected text row rather than only ID/time.
- TypeScript `tsc --noEmit --pretty false`: passed.
- `scripts/release/check-auth-invariants.mjs`: passed.
- `git diff --check`: passed.
- Offline iOS JavaScript/Hermes export: passed, `/tmp/washedup-chat-send-review-export-20261006`; no native build or publication. Sentry auto-upload disabled. No standalone lint command is configured in this repository.
- Logs: `/tmp/washedup-send-before.log`, `/tmp/washedup-send-verification.log`, `/tmp/washedup-send-typecheck.log`, `/tmp/washedup-send-export.log`.

### Native observations on this candidate

Restarted localhost Metro and relaunched only `com.washedup.localdev` through Device Hub. The visible `Candidate send-receipt v2 · Local only · Mona loaded` banner identifies the new fixture. It imports the changed shared ChatThread source. Its transport remains synthetic; the actual useChat transport is tested in the focused automated suites, not in this native fixture.

Observed a normal local send appear once and clear the composer; a failed send retain its original and then complete explicit Retry with one bubble and a cleared composer; a delayed send clear its composer before acknowledgement and preserve a separate next draft; and keyboard-to-attachment-to-keyboard handoff followed by five further cycles, with the same draft and software keyboard reported present after each. A Home/background and warm return also retained the confirmed bubble and separate draft. Corrected the fixture receipt checker to consult locally confirmed IDs/text/reply targets instead of always returning true. No real messages were sent.

The older immediate-send-and-type observation was not reproduced when checking that preparation had cleared the composer first. The focused test also verifies typing while acknowledgement is pending. This does not rule out a separate draft-preparation race under slow storage; that remains a specifically identified follow-up, rather than a claimed fix.

The current screenshot tool returned a partly white window image during keyboard review; native accessibility confirmed keys and the retained draft, but that capture cannot establish complete visual alignment or animation smoothness. Earlier visual keyboard observations remain separate. No cold-open, network delivery, frame-rate or physical-device number is reported. The current fixture bypasses startup and uses an existing build-44 local development binary, so its launch time would not establish production Build 51 cold-open speed. Main-community/topic native interaction, a genuinely long-running soak, and real-device/backend validation remain open.

### Complete comparison with protected release

Base remains `9c2994b10e9f263e98a262e87a9bf7a94ee941c5`; feature branch `feature/chat-loading-20261006`. All repository files changed across the feature branch:

1. `app/community-thread/[id].tsx` — community refresh/reconnect/deadline repair from the earlier commit.
2. `components/chat/ChatThread.tsx` — release text-send lock after validated acknowledgement.
3. `components/chat/__tests__/ChatThreadEntryLifetime.test.tsx` — confirmed-send/newer-draft regression.
4. `components/chat/__tests__/CommunityMainQueryIsolation.test.tsx` — community recovery regressions.
5. `components/keyboard/__tests__/ChatKeyboard.adapter.test.tsx` — repeated keyboard lifecycle coverage.
6. `hooks/useChat.ts` — validate complete text receipt before confirming delivery.
7. `hooks/__tests__/useChat.anchor.test.tsx` — realistic complete receipt fixture.
8. `hooks/__tests__/useChat.ownership.test.tsx` — incorrect receipts, exact recovery and room/account coverage.
9. `hooks/__tests__/useChat.refresh.test.tsx` — repeated visits, synthetic latency, realistic receipts.
10. `docs/chat-reliability-2026-10-06.md` — evidence and limitations.

JavaScript-only; structurally OTA-compatible relative to the protected base, subject to normal integration/device checks. No new native-build ledger item is needed. No merge, push, OTA, build submission, backend deployment or production mutation was performed. The protected release checkout/branch is not part of these changes.


## October 6: community history read overlap

Continued from `96b743e` on the same isolated feature branch. Verified clean feature status, canonical origin, separate worktrees and fetched release commit `9c2994b10e9f263e98a262e87a9bf7a94ee941c5` before editing. Read relevant scope, handoff and native-build instructions; existing production/build restrictions remain in force.

`getCommunityBroadcasts` previously waited for mutual-block checks before starting names/photos, reactions and reply counts. These reads now start together after the source history page arrives. Nothing is returned until privacy succeeds and the current account/visit is rechecked. The existing metadata requirements and strict error behavior remain for visible messages. A fully blocked page still returns empty with the raw cursor, without waiting on metadata. Early and late metadata rejection is handled even when privacy remains pending or the page has already returned empty.

This improves the shared broadcast reader used by legacy main chat, mapped main history and broadcast introductions/anchor reads. It does not change their storage, permissions, pagination, renderer or read acknowledgements.

### Timing evidence and tradeoff

Two virtual-clock tests use a 100 ms history response, then 200/400 ms privacy and metadata responses in opposite orders. With the old sequential dependencies the configured path takes 700 ms; the updated function returns the same permitted, fully enriched row at 500 ms. Neither case returns a page at 499 ms. These are controlled loader tests, not production, native cold-open or animation measurements. Auth is immediate in these fixtures. The improvement replaces two sequential waits with overlapping reads; it still waits for the slower of privacy and metadata and does not yet progressively render message text before metadata.

Tradeoff: metadata requests now include IDs from the fetched source page before the block result is known. Blocked messages and their metadata are never included in the returned page or rendered. The query fields remain unchanged (no handles or extra profile fields), and ID filters remain bounded by the source page. This can fetch metadata that will be discarded, including up to three requests on a fully blocked page that previously skipped metadata. Empty source pages still start no privacy or metadata requests. Server authorization remains unchanged.

### Verification

Eight new controlled-delay/privacy/error cases, plus the existing account-retirement case adjusted to assert no result or further dispatch after retirement rather than prohibiting already-started parallel reads. Before the change, three new overlap cases failed and the other 61 cases in that suite passed. Final run: **166 tests passed across six suites**, normal exit:

- `lib/__tests__/communityOperationScope.test.ts`
- `lib/__tests__/communityRoomHistory.test.ts`
- `lib/__tests__/communityMessageAnchor.test.ts`
- `lib/__tests__/communityConversationRealtime.test.ts`
- `components/chat/__tests__/CommunityMainQueryIsolation.test.tsx`
- `hooks/__tests__/useTopicChat.intros.test.tsx`

Coverage includes privacy finishing after metadata; privacy transport rejection; account changes during privacy/enrichment; metadata rejection before privacy; fully blocked pages with failed or stalled metadata; empty history; retained raw cursors; strict reply-count failures; reaction identity; mapped/legacy rooms; message anchors; introduction routing; and reconnect/return refresh.

Logs: `/tmp/washedup-community-overlap-before.log`, `/tmp/washedup-community-overlap-final.log`, `/tmp/washedup-community-overlap-types.log`, `/tmp/washedup-community-overlap-export.log`. TypeScript, auth invariants, `git diff --check` and offline local iOS/Hermes export all passed. Export output: `/tmp/washedup-community-overlap-export-20261006`; Sentry auto-upload disabled. No standalone lint command is configured. Existing native fixture bypasses this loader, so rerunning that fixture would not validate this change; no new simulator performance claim is made.

This increment changes only `lib/communityChat.ts`, `lib/__tests__/communityOperationScope.test.ts` and this evidence file. Together with the ten-file list above, the full feature comparison now comprises twelve files: the same ten plus those two library files. No native dependency/configuration or database changes; structurally OTA-compatible relative to the protected base, with native/production validation still outstanding. No release or production action performed.


## October 7 — second responsiveness and recovery pass

Added main local pending/confirmed feedback, privacy-gated progressive history, durable separation of the next draft, native clear requests and local development diagnostics. Main and topic now have a reusable current-source native fixture with real AsyncStorage. Final distinct targeted inventory: 2,337 passing tests, three unchanged baseline failures, 159 suites; final TypeScript/auth invariant checks and offline iOS JavaScript export passed. The immediate bulk-input native case remains unresolved; no WhatsApp parity, full Build 51 native coverage or release readiness is claimed. See [the second audit](chat-phase2-audit-2026-10-07.md) for exact evidence, limitations, changed files and release protection.
