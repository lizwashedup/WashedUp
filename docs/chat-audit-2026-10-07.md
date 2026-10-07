# WashedUp chat repair and audit — October 7, 2026

## Decision

The isolated chat repairs are ready for review. They are **not a release, a complete WhatsApp replacement, or proof of production performance**. Preserve the release hold. The next validation gate is the exact candidate running on an approved test installation with two accounts; the existing simulator fixture cannot establish that gate.

Liz does not need to debug the implementation. Her useful contribution after an approved test version is available is a short realistic conversation with another tester, noting the room and action whenever anything feels slow. Keep Hangouts and creator/community creation redesign separate from this repair.

## Repository and release protection

- Canonical origin: `https://github.com/lizwashedup/WashedUp.git` (fetch and push).
- Feature worktree: `/Users/liz/Desktop/WashedUp_HQ/washedup-chat-loading-20261006`.
- Feature branch: `feature/chat-loading-20261006`.
- This continuation started at `71d87749b0399d631767117672ff3702e2dce64e`, the previously committed chat work. Its merge base with the protected release is exactly `9c2994b10e9f263e98a262e87a9bf7a94ee941c5`.
- The protected checkout remains a separate worktree on `release/build51-push-registration-20261006`, clean at that exact release commit. The remote release state was fetched without changing checkout files and matched the protected commit.
- The detached comparison worktree used for tests was also at the exact protected commit. It contained only a temporary dependency symlink in addition to release files; it is removed after the audit.
- No PR merge, branch publication, OTA, native build, backend deployment, notification, production-data change, secret/configuration change, or Sentry mutation. No closed PR was restored.
- All changes are JavaScript/TypeScript, tests and documentation. No dependency, native configuration, schema or migration change. Structurally OTA-compatible with the protected base, **subject to integration and device validation**; no native-build ledger entry required. No release action is authorized by this report.

## Repairs completed in this continuation

1. **Community send recovery gets time to finish.** A 12-second outer timeout previously competed with the insert's own 12-second limit. The UI could retire a send just as its lost-response recovery began. Main-message and reply send guards now allow 35 seconds, covering the bounded identity (8 seconds), insert (12 seconds) and lookup (8 seconds) phases. These are failure limits, not added delays on successful requests. Reply operations previously missing inner limits now have them. A late result cannot clear a newer draft or complete a retired attempt. Recovery checks the original UUID; it does not automatically send a second message.
2. **Topic sends stop waiting on redundant reads.** New text sends rely on the hook's validated saved-message receipt. They no longer perform a redundant pre-send lookup and post-send lookup. The history refresh runs without holding the composer lock after confirmation. Retry recovery and edit verification retain their checks.
3. **Main/topic text acknowledgements validate the actual intent.** Receipt checks include message ID, destination, sender, content, text-versus-media fields, and mention identity; topic messages also check reply identity. A mismatched receipt cannot silently finish the draft. Existing media handling is preserved.
4. **Chat test fixtures match the implemented interface again.** Updated safe-area mocks, a missing infinite-query `refetch`, stable visit callbacks, inverted-list scroll expectations, and notification-menu tests that now open and dismiss the actual menu before asserting its action. The dedicated legacy notification-controller tests explicitly exercise the legacy presentation. Existing lexical navigation/list checks now reflect the release's current navigation and independent list-loading implementation; behavior is additionally exercised by component/hook tests.

Earlier isolated commits also repaired main-chat catch-up on return/reconnect, prevented overlapping refresh signals from restarting the same request, stopped repeated timeout retries, removed a redundant confirmation read in Plan/Circle/DM sends, and overlapped community metadata reads with required privacy checks. Their evidence and caveats are in [the running repair record](chat-reliability-2026-10-06.md).

## Verification and audit method

**Final combined inventory: 157 suites, 155 passing suites; 2,315 passing tests, 3 failing tests, 0 pending tests.** This is a targeted chat plus adjacent startup/auth/notification audit, not the entire repository test suite or production end-to-end certification.

The first broader pass ran 142 suites in independent Jest processes, with two processes at a time, a 60-second limit per suite and normal process exit. This avoids the documented legacy single-process runner contamination. No suite required forced exit. It initially recorded 2,056 passing and 48 failing tests in nine suites. The same nine suites were run in the untouched release comparison worktree: eight already failed there (41 failing tests); the community photo suite passed there. Its seven candidate failures were traced to the test double missing `refetch`, which the changed main screen now calls on focus; the real query supplies that API.

After chat fixture repairs, the 16 affected/previously failing suites were rerun: 470 passed, 3 failed. Three additional deadline regressions were then added and their two affected suites passed (132 tests). Fifteen additional startup/sign-in/onboarding/notification-entry suites passed (211 tests). The inventory below replaces earlier results for rerun suites; repeated executions are not added together to inflate the total.

Focused before/after reproduction also established the production defects: three initial deadline cases failed before repair; the topic fast-path/receipt cases failed before repair; and seven wrong-field main receipts were wrongly accepted before repair. The corrected cases now pass. Tests include:

- Recovery still active at 14 seconds, then completing once; newer text remains intact.
- Stalled reply authentication ends at 8 seconds without a write.
- Stalled reply insert starts a same-ID lookup after 12 seconds; a stuck lookup then ends within its 8-second phase limit without a second insert.
- Fully stalled outer sends expose explicit recovery while retaining the original.
- Fresh topic text send completes even if redundant receipt/history reads would never resolve.
- Incorrect ID, destination, sender, body, media/type, reply and mention receipts cannot confirm text delivery.
- Account/room retirement, double taps, explicit retries, permissions, privacy, long history, scroll anchors, drafts, photos, voice, notification preferences and keyboard lifecycle.
- Existing repeated-use cases: 40 Plan visits, 40 Circle visits and 120 synthetic keyboard cycles. These are lifecycle tests, not a native memory or frame-rate benchmark.

Other checks:

- TypeScript `tsc --noEmit --pretty false`: passed, rerun after final test changes.
- `node scripts/release/check-auth-invariants.mjs`: passed; source-only check, no referenced production SQL executed.
- Local offline iOS JavaScript/Hermes export: passed at `/tmp/washedup-chat-audit-export-20261007`. Telemetry/dotenv loading disabled and Sentry auto-upload disabled. This did not create a native app build or publish an update.
- `git diff --check`: passed.
- Standalone lint: no configured lint command/config found; not claimed as run and no tooling installed.
- Startup/auth/native/backend configuration comparison against the protected base: no changes to `app/_layout.tsx`, `app/(auth)`, `supabase`, package manifests, native directories, Expo configuration or EAS configuration.
- Runtime used for local verification: bundled Node 24.19; repository's intended Node 20 environment still needs normal CI validation at integration. Dependencies were reused through a temporary symlink, not installed or upgraded.

Reproduction pattern: run the repository Jest CLI with `--runInBand --ci --silent --runTestsByPath <suite>`, one separate process per suite. Keep failures visible. Do not substitute the aggregate for the full legacy `qa:all`, database integration tests or actual device journeys.

## Three unresolved checks: reproduced on the protected release

| Suite | Failing cases | Observed failure and disposition |
| --- | ---: | --- |
| `lib/__tests__/communityPageRead.test.ts` | 1 | Empty community page fixture reaches an undefined query result at `lib/communityPage.ts:90`. Same failure on protected release. Outside this chat repair; code and fixture unchanged. |
| `lib/__tests__/setupCommunityLanding.test.ts` | 2 | Static assertions expect older creator-access invalidation/navigation source strings. Same failures on protected release. Creator setup is separately queued; code and fixture unchanged. |

These remain failures. They are not declared harmless product behavior or silently counted as passing. No new failing test remains in the selected audit inventory after fixing the chat fixture regression.

## Native evidence and practical limits

The native fixture runs only `com.washedup.localdev` (existing version 1.0.6/build 44) on the iPhone 17e simulator. It imports the candidate shared ChatThread/keyboard implementation but uses synthetic message transport and in-memory storage; startup is bypassed. It is **not the production Build 51 app**. The latest main/topic transport changes were tested through actual source in automated suites, not through this shared-chat-only native fixture.

Observed previously on this candidate: normal send, one-bubble explicit retry, a delayed acknowledgement preserving a separate next draft, keyboard/attachment handoffs, 500-message history and scrolling, and warm background/return draft retention. During this audit, the prior draft was still present on return; a separate 500-message case exposed the expected final history rows. Rapid fixture switches were not counted as completed history loads. A partly white Device Hub screenshot prevents reliable full-screen visual/animation judgment. There is no measured production cold-open, cross-device delivery, frame-rate or memory number, and no claimed controlled long-duration native soak. Virtual-clock timings in earlier evidence are not phone timings.

## What remains, in priority order

1. **Validate the exact integrated candidate on an approved test installation.** Only after PR #14 is safely merged and integration/release instructions permit it. Confirm commit/binary identity first. Use two dedicated test accounts and record both screens and timestamps for cold open, warm return, outgoing acknowledgement and incoming display. Repeat on Wi-Fi and cellular; include a connection interruption, explicit retry, background/return and notification opening. Do not send test messages to real member groups. Backend writes/notifications need an approved test environment; none were performed here.
2. **Measure main-community opening and make pending sends clearer.** Its source reader still waits for required metadata even though reads now overlap. Main community also does not yet share the full optimistic pending-bubble interaction used by other chats. Progressive rendering must retain privacy gates and accurate reaction/reply state. This work is not represented as completed by the transport repair.
3. **Investigate typing during slow draft preparation.** A separate draft typed after preparation is covered and preserved. The earlier immediate-send-and-type observation before preparation clears remains an unproven storage/interaction edge case. Do not clear early in a way that loses an original when validation fails.
4. **Offline multi-message outbox and broader interaction consistency remain product engineering.** Current recovery retains one original attempt and offers explicit check/retry. It is not a durable multi-message background queue. Main-community/topic native keyboard/layout parity and physical-device longevity still need validation.

A practical founder test, once the approved version exists: exchange several messages/replies/photos with one other tester; type a second message immediately; scroll far back with the keyboard open; leave and return; repeat after a network interruption. Report the room type, approximate time and a short screen recording if anything feels wrong. The engineering follow-up should reproduce and fix that evidence, not ask Liz to diagnose it.

## Full file comparison with protected commit

Base: `9c2994b10e9f263e98a262e87a9bf7a94ee941c5`. The full candidate file list (including prior isolated chat commits) is below. Use `git diff 9c2994b10e9f263e98a262e87a9bf7a94ee941c5...feature/chat-loading-20261006` after the final audit commit for review.

- `app/community-thread/[id].tsx`
- `app/community-topic/[id].tsx`
- `components/chat/ChatThread.tsx`
- `components/chat/__tests__/ChatThreadEntryLifetime.test.tsx`
- `components/chat/__tests__/ChatUxContract.test.ts`
- `components/chat/__tests__/CircleChatMenuLifetime.test.tsx`
- `components/chat/__tests__/CommunityChatPhotos.test.tsx`
- `components/chat/__tests__/CommunityIntroScreen.test.tsx`
- `components/chat/__tests__/CommunityMainEntryLifetime.test.tsx`
- `components/chat/__tests__/CommunityMainHeader.test.tsx`
- `components/chat/__tests__/CommunityMainQueryIsolation.test.tsx`
- `components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx`
- `components/chat/__tests__/CommunityTopicHeader.test.tsx`
- `components/chat/__tests__/CommunityTopicNotifications.test.tsx`
- `components/communities/__tests__/CommunityCompanionLifetime.test.tsx`
- `components/keyboard/__tests__/ChatKeyboard.adapter.test.tsx`
- `docs/chat-audit-2026-10-07.md`
- `docs/chat-reliability-2026-10-06.md`
- `hooks/__tests__/useChat.anchor.test.tsx`
- `hooks/__tests__/useChat.ownership.test.tsx`
- `hooks/__tests__/useChat.refresh.test.tsx`
- `hooks/__tests__/useTopicChat.intros.test.tsx`
- `hooks/__tests__/useTopicChat.mutations.test.tsx`
- `hooks/__tests__/useTopicChat.refresh.test.tsx`
- `hooks/useChat.ts`
- `hooks/useCommunityReplyComposer.ts`
- `hooks/useTopicChat.ts`
- `lib/__tests__/communityOperationScope.test.ts`
- `lib/chatSendReceipt.ts`
- `lib/communityChat.ts`

## Audited suite inventory

Counts are the latest result for each suite; all listed processes exited normally.

| Suite | Passed | Failed |
| --- | ---: | ---: |
| `app/(auth)/__tests__/phone-entry.test.tsx` | 8 | 0 |
| `app/(auth)/onboarding/__tests__/basics.test.tsx` | 5 | 0 |
| `app/(auth)/onboarding/__tests__/basicsColdStart.test.tsx` | 2 | 0 |
| `app/__tests__/notificationResponseEntry.test.ts` | 13 | 0 |
| `app/__tests__/notificationVerifyHandoff.test.tsx` | 46 | 0 |
| `app/__tests__/pageUpdatePush.test.ts` | 20 | 0 |
| `app/__tests__/pushPrimerLifecycle.test.tsx` | 47 | 0 |
| `components/__tests__/InboxNotificationActionLifetime.test.tsx` | 19 | 0 |
| `components/__tests__/InboxPeopleNotificationRoute.test.ts` | 2 | 0 |
| `components/__tests__/PushPrimerModal.test.tsx` | 6 | 0 |
| `components/chat/__tests__/AndroidReactionJourney.test.tsx` | 6 | 0 |
| `components/chat/__tests__/AttachmentSheet.test.tsx` | 6 | 0 |
| `components/chat/__tests__/ChatContextHeader.test.tsx` | 6 | 0 |
| `components/chat/__tests__/ChatEntryState.test.tsx` | 5 | 0 |
| `components/chat/__tests__/ChatMentionPicker.test.tsx` | 3 | 0 |
| `components/chat/__tests__/ChatOptionsButton.test.tsx` | 5 | 0 |
| `components/chat/__tests__/ChatPhotoExperience.test.tsx` | 9 | 0 |
| `components/chat/__tests__/ChatPlanCard.scaling.test.tsx` | 2 | 0 |
| `components/chat/__tests__/ChatScaledLeaves.test.tsx` | 2 | 0 |
| `components/chat/__tests__/ChatThreadComposerAccessibility.test.tsx` | 41 | 0 |
| `components/chat/__tests__/ChatThreadComposerMedia.test.tsx` | 13 | 0 |
| `components/chat/__tests__/ChatThreadEntryLifetime.test.tsx` | 84 | 0 |
| `components/chat/__tests__/ChatUxContract.test.ts` | 5 | 0 |
| `components/chat/__tests__/CircleChatMenuLifetime.test.tsx` | 25 | 0 |
| `components/chat/__tests__/CommunityChatComposer.test.tsx` | 12 | 0 |
| `components/chat/__tests__/CommunityChatPhotos.test.tsx` | 16 | 0 |
| `components/chat/__tests__/CommunityIntroScreen.test.tsx` | 9 | 0 |
| `components/chat/__tests__/CommunityMainEntryLifetime.test.tsx` | 48 | 0 |
| `components/chat/__tests__/CommunityMainHeader.test.tsx` | 6 | 0 |
| `components/chat/__tests__/CommunityMainQueryIsolation.test.tsx` | 25 | 0 |
| `components/chat/__tests__/CommunityTopicEntryLifetime.test.tsx` | 74 | 0 |
| `components/chat/__tests__/CommunityTopicHeader.test.tsx` | 13 | 0 |
| `components/chat/__tests__/CommunityTopicNotifications.test.tsx` | 5 | 0 |
| `components/chat/__tests__/LocationPickerLifetime.test.tsx` | 32 | 0 |
| `components/chat/__tests__/MediaPanel.test.tsx` | 22 | 0 |
| `components/chat/__tests__/MessageActionsMenu.test.tsx` | 11 | 0 |
| `components/chat/__tests__/NotificationEnableFeedback.test.tsx` | 30 | 0 |
| `components/chat/__tests__/PhotoPreviewModal.test.tsx` | 2 | 0 |
| `components/chat/__tests__/PlanChatHeader.test.tsx` | 16 | 0 |
| `components/chat/__tests__/PlanChatLoading.test.tsx` | 5 | 0 |
| `components/chat/__tests__/ReactionChips.test.tsx` | 9 | 0 |
| `components/chat/__tests__/ReactionDetailsSheet.test.tsx` | 8 | 0 |
| `components/chat/__tests__/ReactionEmojiPicker.test.tsx` | 9 | 0 |
| `components/chat/__tests__/TopicWelcomeEditor.test.tsx` | 13 | 0 |
| `components/chat/__tests__/VoicePlayer.test.tsx` | 22 | 0 |
| `components/chat/__tests__/VoiceRecorder.sending.test.tsx` | 3 | 0 |
| `components/communities/__tests__/BroadcastCardAppearance.test.tsx` | 2 | 0 |
| `components/communities/__tests__/CommunityCompanionLifetime.test.tsx` | 55 | 0 |
| `components/communities/__tests__/CommunityJoinEntry.test.tsx` | 33 | 0 |
| `components/communities/__tests__/CommunityJoinEntryModal.test.tsx` | 8 | 0 |
| `components/communities/__tests__/CommunityManageLink.test.tsx` | 8 | 0 |
| `components/communities/__tests__/CommunityPageActionLifetime.test.tsx` | 16 | 0 |
| `components/communities/__tests__/CommunityPageMountedText.test.tsx` | 2 | 0 |
| `components/communities/__tests__/CommunityPeople.test.tsx` | 7 | 0 |
| `components/communities/__tests__/JoinCommunityPopup.test.tsx` | 7 | 0 |
| `components/keyboard/__tests__/ChatKeyboard.adapter.test.tsx` | 9 | 0 |
| `hooks/__tests__/chatPaging.test.ts` | 4 | 0 |
| `hooks/__tests__/useActiveChatPresence.test.tsx` | 18 | 0 |
| `hooks/__tests__/useAttendeeMessageSend.test.tsx` | 26 | 0 |
| `hooks/__tests__/useChat.anchor.test.tsx` | 12 | 0 |
| `hooks/__tests__/useChat.ownership.test.tsx` | 98 | 0 |
| `hooks/__tests__/useChat.refresh.test.tsx` | 38 | 0 |
| `hooks/__tests__/useChatComposerDraft.prepare.test.tsx` | 6 | 0 |
| `hooks/__tests__/useChatComposerDraft.test.tsx` | 10 | 0 |
| `hooks/__tests__/useChatEngine.deadPath.test.ts` | 1 | 0 |
| `hooks/__tests__/useChatInputHeight.test.tsx` | 11 | 0 |
| `hooks/__tests__/useChatList.expiry.test.tsx` | 1 | 0 |
| `hooks/__tests__/useChatList.history.test.tsx` | 3 | 0 |
| `hooks/__tests__/useChatList.loading.test.tsx` | 14 | 0 |
| `hooks/__tests__/useChatMentionFocus.test.tsx` | 4 | 0 |
| `hooks/__tests__/useChatMessageAnchor.test.tsx` | 4 | 0 |
| `hooks/__tests__/useCircle.account.test.tsx` | 22 | 0 |
| `hooks/__tests__/useCommunityBroadcastMute.test.tsx` | 12 | 0 |
| `hooks/__tests__/useCommunityChatPreference.test.tsx` | 10 | 0 |
| `hooks/__tests__/useCommunityChatRows.test.tsx` | 16 | 0 |
| `hooks/__tests__/useCommunityConversationNotifications.test.tsx` | 10 | 0 |
| `hooks/__tests__/useCommunityCoreReadAcknowledgement.test.tsx` | 12 | 0 |
| `hooks/__tests__/useCommunityRoomDirectory.test.tsx` | 9 | 0 |
| `hooks/__tests__/useCommunityTopicMute.test.tsx` | 11 | 0 |
| `hooks/__tests__/useCreatorCommunityGroups.test.tsx` | 13 | 0 |
| `hooks/__tests__/usePushNotifications.lifetime.test.tsx` | 106 | 0 |
| `hooks/__tests__/useTopicChat.intros.test.tsx` | 18 | 0 |
| `hooks/__tests__/useTopicChat.mutations.test.tsx` | 71 | 0 |
| `hooks/__tests__/useTopicChat.refresh.test.tsx` | 47 | 0 |
| `hooks/__tests__/useTopicComposerDraft.test.tsx` | 14 | 0 |
| `hooks/__tests__/useVoiceRecorder.lifetime.test.tsx` | 23 | 0 |
| `lib/__tests__/accountEmailReturn.test.ts` | 2 | 0 |
| `lib/__tests__/attendeeMessageHistory.test.ts` | 6 | 0 |
| `lib/__tests__/attendeeMessageNotification.test.ts` | 23 | 0 |
| `lib/__tests__/attendeeMessageSend.test.ts` | 12 | 0 |
| `lib/__tests__/attendeeMessageTestReceipt.test.ts` | 7 | 0 |
| `lib/__tests__/authRouting.test.ts` | 2 | 0 |
| `lib/__tests__/chatComposerDraft.test.ts` | 16 | 0 |
| `lib/__tests__/chatLocation.test.ts` | 10 | 0 |
| `lib/__tests__/chatMentionIdentity.test.ts` | 14 | 0 |
| `lib/__tests__/chatMentions.test.ts` | 10 | 0 |
| `lib/__tests__/chatMessageEdit.test.ts` | 14 | 0 |
| `lib/__tests__/chatPhotoBatch.test.ts` | 2 | 0 |
| `lib/__tests__/chatPhotoLayout.test.ts` | 6 | 0 |
| `lib/__tests__/chatReactionReader.test.ts` | 5 | 0 |
| `lib/__tests__/communityBlocks.test.ts` | 2 | 0 |
| `lib/__tests__/communityChatExpiry.test.ts` | 8 | 0 |
| `lib/__tests__/communityChatInbox.test.ts` | 11 | 0 |
| `lib/__tests__/communityChatMutePolicy.test.ts` | 22 | 0 |
| `lib/__tests__/communityChatNotificationState.test.ts` | 12 | 0 |
| `lib/__tests__/communityChatPreference.test.ts` | 20 | 0 |
| `lib/__tests__/communityChatUi.test.ts` | 3 | 0 |
| `lib/__tests__/communityConversationRealtime.test.ts` | 13 | 0 |
| `lib/__tests__/communityIntroRoom.test.ts` | 5 | 0 |
| `lib/__tests__/communityIntroductionText.test.ts` | 8 | 0 |
| `lib/__tests__/communityJoin.test.ts` | 10 | 0 |
| `lib/__tests__/communityJoinNotification.test.ts` | 13 | 0 |
| `lib/__tests__/communityLocationMessage.test.ts` | 2 | 0 |
| `lib/__tests__/communityManageEntry.test.ts` | 15 | 0 |
| `lib/__tests__/communityMessageAnchor.test.ts` | 14 | 0 |
| `lib/__tests__/communityMutePreference.test.ts` | 9 | 0 |
| `lib/__tests__/communityNoticeDestination.test.ts` | 25 | 0 |
| `lib/__tests__/communityOperationScope.test.ts` | 77 | 0 |
| `lib/__tests__/communityOptionalRoom.test.ts` | 7 | 0 |
| `lib/__tests__/communityPage.test.ts` | 2 | 0 |
| `lib/__tests__/communityPageRead.test.ts` | 3 | 1 |
| `lib/__tests__/communityReactionChips.test.ts` | 7 | 0 |
| `lib/__tests__/communityRoomHistory.test.ts` | 29 | 0 |
| `lib/__tests__/communityRoomInbox.test.ts` | 7 | 0 |
| `lib/__tests__/communityRoomWindow.test.ts` | 6 | 0 |
| `lib/__tests__/communityRouteGate.test.ts` | 5 | 0 |
| `lib/__tests__/creatorCommunityGroupAttempt.test.ts` | 6 | 0 |
| `lib/__tests__/creatorCommunityGroups.test.ts` | 7 | 0 |
| `lib/__tests__/creatorCommunityJoin.test.ts` | 21 | 0 |
| `lib/__tests__/eventTopicLookup.test.ts` | 2 | 0 |
| `lib/__tests__/expoNotificationResponses.test.ts` | 27 | 0 |
| `lib/__tests__/memberChatMessageAnchor.test.ts` | 19 | 0 |
| `lib/__tests__/memberReactionPushRoute.test.ts` | 17 | 0 |
| `lib/__tests__/messageReactionDetails.test.ts` | 12 | 0 |
| `lib/__tests__/navState.otp.test.ts` | 1 | 0 |
| `lib/__tests__/notificationChannels.test.ts` | 3 | 0 |
| `lib/__tests__/onboardingDraft.test.ts` | 11 | 0 |
| `lib/__tests__/onboardingDraftColdStart.test.ts` | 4 | 0 |
| `lib/__tests__/operatorApplications.accountRead.test.ts` | 3 | 0 |
| `lib/__tests__/pageInvitationNotification.test.ts` | 21 | 0 |
| `lib/__tests__/phoneFormat.test.ts` | 8 | 0 |
| `lib/__tests__/photoSendSession.test.ts` | 3 | 0 |
| `lib/__tests__/planChatExpiry.test.ts` | 6 | 0 |
| `lib/__tests__/refundAuthority.test.ts` | 22 | 0 |
| `lib/__tests__/restoreChatDraft.test.ts` | 2 | 0 |
| `lib/__tests__/sceneCommunityLocations.test.ts` | 5 | 0 |
| `lib/__tests__/sceneCommunityPagination.test.ts` | 4 | 0 |
| `lib/__tests__/setupCommunityLanding.test.ts` | 1 | 2 |
| `lib/__tests__/textSendSession.test.ts` | 1 | 0 |
| `lib/__tests__/topicAlbum.test.ts` | 12 | 0 |
| `lib/__tests__/topicComposerDraft.test.ts` | 28 | 0 |
| `lib/__tests__/topicLoadedHistory.test.ts` | 5 | 0 |
| `lib/__tests__/topicNotificationPreference.test.ts` | 12 | 0 |
| `lib/__tests__/topicPendingMessages.test.ts` | 4 | 0 |
| `lib/__tests__/topicSendReceipt.test.ts` | 3 | 0 |
| `lib/__tests__/topicWelcome.test.ts` | 10 | 0 |
| `lib/firstJoin/__tests__/onboardingGate.test.ts` | 10 | 0 |
