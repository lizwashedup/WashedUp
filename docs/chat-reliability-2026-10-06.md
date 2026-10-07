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
