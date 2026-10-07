# Topic and event-chat mute reliability

Isolated native implementation, September 12. This changes the existing per-topic preference UI/controller; no production operation or push-provider test was performed.

## Demonstrated failures and repair

The old topic screen interpreted missing payload as notifications off, accepted overlapping toggle taps and treated a completed update as a confirmed setting. Three actual-screen regressions failed before the repair.

`useCommunityTopicMute` now observes the existing account without changing authentication, scopes reads/saves to a specific topic and account visit, and serializes toggles. An initial or uncertain preference is unknown, not an invented on/off value. A retry from unknown reads the saved setting before offering another change.

`topicNotificationPreference` updates only `community_topic_members.notifications_on` for the original `(topic_id, user_id)`. It checks identity and the active scope before writing, requires the matching membership-row receipt, and reads the authoritative value back. A lost write response can therefore be confirmed without a duplicate update. A mismatch or failed read remains explicit. No membership is inserted, no history/read marker is changed and no parent-community preference is inherited.

The existing bell slot shows checking, unknown/retry, muted or unmuted state and disables pending taps. Unconfirmed results explain how to check/retry. Feedback from a retired room/account is discarded, including A → B → A. An event attendee only needs their existing topic membership; this does not require or create community membership.

## Files and checks

Runtime files: `hooks/useCommunityTopicMute.ts`, `lib/topicNotificationPreference.ts`, and only imports/toggle wiring/status content in `app/community-topic/[id].tsx`.

Tests: `components/chat/__tests__/CommunityTopicNotifications.test.tsx` (5 screen cases), `hooks/__tests__/useCommunityTopicMute.test.tsx` (11), `lib/__tests__/topicNotificationPreference.test.ts` (12). Combined with the existing main-room controller and preference/receipt tests, **49/49 pass** across five suites. TypeScript noEmit, scoped diff checks and open-handle detection pass. Checks use mocked transport; the earlier main-room package retains its independent evidence.

The topic screen's header geometry, existing room/intro/archived gates, lifecycle and message transport are unchanged. Native physical touch/reader testing remains. Muting this saved preference does not prove queued/retried pushes are suppressed: the source-aware delivery contract in `community-mute-contract-2026-09-12.md` still requires server implementation and verification.
