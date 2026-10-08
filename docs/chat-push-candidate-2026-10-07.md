# Chat and push integration candidate — October 7, 2026

Status: locally integrated and checked; public release remains held. Sentry and live Supabase verification are awaiting the founder's browser sign-in. The combined candidate has not been installed on a phone or published.

## Source provenance

- Repository: `https://github.com/lizwashedup/WashedUp.git`.
- Isolated worktree: `/Users/liz/Desktop/WashedUp_HQ/washedup-chat-push-candidate-20261007`.
- Feature branch: `feature/chat-push-candidate-20261007`.
- Original protected release commit: `9c2994b10e9f263e98a262e87a9bf7a94ee941c5`.
- Remote main observed after fetch: `d7bdb9a8a4f1e648bd2309c10db8408e5062ff99`. GitHub reports PR #14 merged at `2026-10-07T08:03:31Z`. This task did not merge it.
- Chat parent: `738a4b207218aec3d44e9aa085f25c5da3eb0891`.
- Push parent: `701c91bcbf80dfa1ab2f8535f217ce4bdd6fb955`.
- Combined app-source commit: `3cbb1da2bd9dcc24f34c3dd24a4910ffa6093540`.

The candidate began at the existing isolated chat feature tip and normally merged the exact newer push tip, without conflicts or cherry-picking. Both descend from the protected release source. Original chat, push, and release branches were preserved. No application logic was additionally changed during this integration. The new files from this pass are this record and the catalog inspection query.

## Verification

Evidence directory: `/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/combined-candidate-20261007`.

The pinned Node 20.20.1 runtime was downloaded from nodejs.org and verified against its official SHA256 manifest. Tests used the existing dependency installation; package manifests and lockfiles are unchanged.

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript, Node 20.20.1 | Pass | `node20-typecheck.log` |
| Offline iOS export, Node 20.20.1 | Pass; local output only; Sentry upload disabled | `node20-ios-export.log` |
| All changed Jest suites | 47/47 pass; 1,263 tests pass | `changed-suite-summary.json` |
| Entire Jest inventory, each suite in a separate process | 567 suites: 541 pass, 25 fail, 1 times out; 8,501 passed tests, 129 failed, 1 pending | `node20/summary.json` |
| Failed-suite comparison with unchanged main | All 26 reproduce on `d7bdb9a`, including the timeout; same failed test names and exit outcomes; zero candidate-only failed assertions | `baseline-comparison.json`, `baseline-node20/summary.json` |
| Review-only block policy contracts | 99 assertions pass in disposable PostgreSQL 17.11; no live connection | `block-sql-contract.log` |
| Catalog inspection SELECT | Executes successfully against disposable fixture | `catalog-select-fixture.log` |
| Deno notification and delivery policy tests | 28 pass, zero fail; local Deno 2.9.4, while CI specifies 2.9.5 | `deno-notifications.log` |
| Required `qa:all` | Incomplete: stops at Docker-dependent consent-sync database contracts; `docker` unavailable | `mandatory-qa.log` |
| Repository `qa/guinea-verify-washedup.sh` | Attempted; stops at the same Docker-dependent step; later cross-repository checks not reached | `guinea-verification.log` |
| Whitespace/conflict-marker diff check | Pass against the protected release commit | Git diff check |

The required gate passed no-cloud-build, paid-ticket-flow, migration policy, auth routing/phone tests, and auth invariants before stopping at Docker. Static contracts passed for all 311 migration files. The scoped native PostgreSQL block contracts are additional evidence, not a replacement for the full Docker gate. The full-suite baseline comparison also does not turn the required gate green. The earlier Node 24 inventory had different results and is superseded for release assessment by the pinned Node 20 run above.

No lint script is configured in package.json. No failures were hidden, skipped in the required command, or used to justify unrelated application changes.

## Sentry hang reports — investigation pending authentication

The WashedUp Sentry organization tab is at `https://sentry.io/auth/login/washedup/`. No event details, issue stacks, counts, affected-user counts, or occurrence times have been retrieved. The reported emails therefore have no established cause yet.

Read-only inspection after sign-in must establish:

1. Exact issue/event, first and latest occurrence, event time versus email delivery time, and frequency.
2. Whether it is an iOS app hang, Android ANR, JavaScript error, or another issue category.
3. Release, distribution, device/OS, Expo update channel and update ID, and embedded/emergency launch context.
4. Available main-thread stack, JavaScript stack and breadcrumbs before the hang; whether chat, startup, keyboard, image loading, or another screen is implicated.
5. Whether the relevant code exists in this candidate, with a focused reproduction before changing it.

The installed Sentry SDK already provides Expo update context with `channel`, `update_id`, `runtime_version`, and `is_embedded_launch` when available. App version `1.0.7 (51)` alone cannot distinguish public code from the private push preview. A missing context is unknown, not evidence that the event came from production. Sentry settings, issue status, and filters have not been changed by this task.

## Live blocking verification — pending authentication

Intended Supabase project: `upstjumasqblszevlgik`. Its browser login is waiting for the founder. No production SQL was executed.

`scripts/db-contracts/inspect-private-chat-blocks.sql` is a catalog-only SELECT. It inspects relevant RLS, policies, function bodies/execute permissions, and block-column types without reading member rows, messages, tokens, or secrets. It must be run only after the intended project is visibly confirmed.

The existing review-only block policy remains in `docs/database/review-only/20261007120000_private_chat_block_boundary.sql`. It has not been promoted into active migrations or deployed. Local fixtures demonstrate its intended behavior; they do not establish the live database's behavior. Compare live security-definer RPCs, direct table access, Realtime, and notification paths before recommending a complete server-side blocking guarantee. Profile/storage visibility and shared-group history are separate from hiding an unnamed two-person DM.

The merged push change includes active migration `20261007130000_push_registration_state.sql`. Its live presence and grants also need verification. This task has not deployed it. Push registration itself remains separate from the best-effort diagnostic writes.

## Phone and release boundary

The paired iPhone exposes WashedUp version 1.0.7, build 51. The Push Notifications task records its installed private preview as source `701c91b`, EAS build `98f98af6-3ebb-49d6-be89-db3fc8106275`, using the preview update channel. That version does not contain this combined chat candidate. App version/build visibility is not proof of exact source.

Before private testing, prepare a delivery route with a verified recipient/channel scope and recovery path; do not publish to a shared channel on assumption. Verify the delivered source/update identity, then exercise cold open, inbox/chat entry, scroll during message arrival and history loading, keyboard open/close, sending/retry, background return, and block-from-private-chat behavior. Existing device evidence for the push preview cannot be relabeled as testing the combined candidate.

There are no changes to native dependencies, package manifests/lockfiles, app configuration, EAS configuration, iOS, or Android directories against the release/main baseline. These JavaScript changes are compatible in principle with the verified Build 51 runtime and introduce no new native-build requirement. Database changes need separate verified deployment; OTA compatibility does not deploy policies or prove device behavior.

No OTA, native build, store submission, remote Git push, production mutation, OneSignal notification, or Sentry state change was performed in this integration pass. Public release remains held for the outstanding live evidence, exact-device verification, and unresolved required release gate.

## Changed-file inventory

The appended inventory is the complete path comparison against the protected release source. Reproduce it with `git diff --name-status 9c2994b10e9f263e98a262e87a9bf7a94ee941c5..HEAD`. The app-source comparison against observed main is the same because the release merge introduced no additional file differences.

```text
M	app/__tests__/pushPrimerLifecycle.test.tsx
M	app/_layout.tsx
M	app/community-thread/[id].tsx
M	app/community-topic/[id].tsx
M	components/LinkifiedText.tsx
M	components/MiniProfileCard.tsx
A	components/__tests__/LinkifiedText.performance.test.tsx
M	components/__tests__/MiniProfileCard.lifetime.test.tsx
M	components/chat/ChatThread.tsx
M	components/chat/__tests__/ChatThreadComposerAccessibility.test.tsx
M	components/chat/__tests__/ChatThreadEntryLifetime.test.tsx
M	components/chat/__tests__/ChatUxContract.test.ts
M	components/chat/__tests__/CircleChatMenuLifetime.test.tsx
M	components/chat/__tests__/CommunityChatPhotos.test.tsx
M	components/chat/__tests__/CommunityIntroScreen.test.tsx
M	components/chat/__tests__/CommunityMainEntryLifetime.test.tsx
M	components/chat/__tests__/CommunityMainHeader.test.tsx
M	components/chat/__tests__/CommunityMainQueryIsolation.test.tsx
M	components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx
M	components/chat/__tests__/CommunityTopicHeader.test.tsx
M	components/chat/__tests__/CommunityTopicNotifications.test.tsx
M	components/communities/__tests__/CommunityCompanionLifetime.test.tsx
M	components/keyboard/__tests__/ChatKeyboard.adapter.test.tsx
A	docs/chat-audit-2026-10-07.md
A	docs/chat-failure-research-2026-10-07.md
A	docs/chat-full-recheck-2026-10-07.md
A	docs/chat-phase2-audit-2026-10-07.md
A	docs/chat-push-candidate-2026-10-07.md
A	docs/chat-reliability-2026-10-06.md
A	docs/database/review-only/20261007120000_private_chat_block_boundary.sql
M	hooks/__tests__/useBlock.scope.test.tsx
M	hooks/__tests__/useChat.anchor.test.tsx
M	hooks/__tests__/useChat.ownership.test.tsx
M	hooks/__tests__/useChat.refresh.test.tsx
M	hooks/__tests__/useChatComposerDraft.prepare.test.tsx
M	hooks/__tests__/useChatComposerDraft.test.tsx
A	hooks/__tests__/useChatList.blocking.test.tsx
M	hooks/__tests__/useChatMessageAnchor.test.tsx
A	hooks/__tests__/useChatReplyScroll.test.tsx
A	hooks/__tests__/useChatResumeRefresh.test.tsx
A	hooks/__tests__/useChatScrollFollow.test.tsx
M	hooks/__tests__/useCircle.account.test.tsx
A	hooks/__tests__/useCommunityLocalDelivery.test.tsx
A	hooks/__tests__/useNetworkStatus.test.tsx
M	hooks/__tests__/usePushNotifications.lifetime.test.tsx
M	hooks/__tests__/useTopicChat.intros.test.tsx
M	hooks/__tests__/useTopicChat.mutations.test.tsx
M	hooks/__tests__/useTopicChat.refresh.test.tsx
M	hooks/__tests__/useTopicComposerDraft.test.tsx
M	hooks/__tests__/useTypingIndicator.lifetime.test.tsx
M	hooks/useBlock.ts
M	hooks/useChat.ts
M	hooks/useChatComposerDraft.ts
M	hooks/useChatList.ts
M	hooks/useChatMessageAnchor.ts
A	hooks/useChatReplyScroll.ts
A	hooks/useChatResumeRefresh.ts
A	hooks/useChatScrollFollow.ts
M	hooks/useCircle.ts
A	hooks/useCommunityLocalDelivery.ts
M	hooks/useCommunityReplyComposer.ts
M	hooks/useNetworkStatus.ts
M	hooks/usePushNotifications.ts
M	hooks/useTopicChat.ts
M	hooks/useTopicComposerDraft.ts
M	hooks/useTypingIndicator.ts
A	lib/__tests__/blocking.test.ts
A	lib/__tests__/chatPerformance.test.ts
A	lib/__tests__/chatRealtimeSubscription.test.ts
M	lib/__tests__/communityChatUi.test.ts
M	lib/__tests__/communityOperationScope.test.ts
M	lib/__tests__/communityRoomHistory.test.ts
A	lib/__tests__/pushRegistrationTelemetry.test.ts
A	lib/__tests__/storageObjectConflict.test.ts
M	lib/__tests__/uploadAudio.scope.test.ts
A	lib/__tests__/uploadPhoto.retry.test.ts
M	lib/blocking.ts
M	lib/chatComposerDraft.ts
A	lib/chatListCache.ts
A	lib/chatPerformance.ts
A	lib/chatRealtimeSubscription.ts
M	lib/chatSendReceipt.ts
M	lib/communityChat.ts
M	lib/communityChatUi.ts
M	lib/communityConversationRealtime.ts
M	lib/communityRoomHistory.ts
A	lib/pushRegistrationTelemetry.ts
A	lib/storageObjectConflict.ts
M	lib/topicComposerDraft.ts
M	lib/uploadAudio.ts
M	lib/uploadPhoto.ts
A	scripts/chat-lab/README.md
A	scripts/chat-lab/run.mjs
A	scripts/chat-lab/schema.sql
A	scripts/db-contracts/inspect-private-chat-blocks.sql
M	scripts/db-contracts/migration-contracts.json
A	scripts/db-contracts/test-private-chat-blocks.py
A	supabase/migrations/20261007130000_push_registration_state.sql
A	supabase/tests/contracts/20261007_private_chat_block_fixture.sql
```
