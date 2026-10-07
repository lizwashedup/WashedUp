# Chat reliability: first isolated repair

Date: October 6, 2026 (America/Los_Angeles).

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
