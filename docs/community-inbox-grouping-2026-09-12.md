# Native community inbox grouping candidate

September 12, 2026. Isolated implementation, with the grouping UI behind `COMMUNITY_CHAT_GROUPING_ENABLED`. The switch requires both a development build and `EXPO_PUBLIC_COMMUNITY_CHAT_GROUPING_ENABLED=true`. No environment was changed, build published, provider configured or production data written in this pass.

## Implemented

- Preserve explicit event provenance in existing flattened source rows: `eventId`, `isDefault`, and the existing stream's `roomName`. No new RPC or database query was added to obtain these fields; they were already present in the payload.
- Pure `projectCommunityChatInbox` produces one parent from each existing community record. Only joined persistent rooms contribute to its activity, preview and unread total. Event rooms stay independent, with a shortcut using the same original object/target inside an existing community parent.
- Duplicate card/attendee representations of one topic contribute one row/count. Nonmember attendee rows never create a community parent. Older cached rows with unknown provenance stay separate until refreshed rather than being incorrectly classified as persistent chats.
- The gated outer Chats list shows community parents in All/Communities and event rooms in All/Plans. This is a Chats filter, not Plans discovery. Original Plan/Circle navigation and event-topic introduction/lifecycle screens remain in place.
- An inline native community directory reuses the existing chat row system, original community imagery, title/preview/time/unread controls, and the existing bottom navigation. Back to Chats, View community and opening a specific original room are distinct actions. Opening the directory marks no room read.
- A separate session-reactive community query hook scopes rows to user ID and account epoch. It cancels/rejects stale reads, including A → B → A, and does not read rows without a session. Initial session errors can be retried. The shared legacy auth hook and login paths are unchanged. Existing prefix invalidations remain compatible. Pull-to-refresh also refreshes community rows. Initial/failed/missing directory data has loading/retry/access-change states. Event-only attendees see a Communities invitation rather than a blank filter.
- Accessible room labels announce name and actual unread count. Android back closes the inline directory before leaving Chats.

## Preservation and incomplete work

The existing broadcast stream still combines introduction cards and ordinary conversation. This code keeps that stream's original identity and name; it does not relabel mixed history as Intros, split messages, join members to a new room or rewrite read markers. The new Intros/main provisioning and preservation transition remains a separate required package. The creator's existing non-event room names are preserved.

Whole-community mute does not currently have an atomic source contract. This directory points to the existing per-chat mute controls instead of presenting an unwired Mute all action. Independent room preferences, opt-in education, aggregated reaction notifications, reliable OneSignal delivery and confirmed app/device badge behavior remain work items.

This is a native structure candidate using current font/color tokens, not completion of the Mona Sans visual-system conversion or pixel parity with the approved browser designs. Live registration, server/RLS/cron correctness, actual device scrolling, VoiceOver/TalkBack, tab return, push destinations and large history performance were not exercised. The current source's shared limit of 120 topic preview messages can still omit a quieter room's latest preview; this pass preserves that query rather than claiming to fix its performance contract.

## Verification

- 10 projection tests: persistent aggregation, independent event identity/counts, nonmember attendee, duplicate topic provenance, legacy unknown rows, ordering/timestamps and input preservation.
- 3 native component tests: no automatic room opening, original stream/room callback identity, separate community navigation and return.
- 4 outer Chats-screen tests: event-only filter state, grouping/navigation, initial loading and retry.
- 10 session-hook tests: initial-read races, account changes, stale results, sign-out, guarded refetch, prefix invalidation, error retry and unsubscribe.
- Four targeted suites: **27 tests passed**.
- Full noEmit TypeScript passed; `git diff --check` passed.
- Existing dependencies were used through a temporary symlink, removed after checks; no dependency installation or update was performed.

## Next

Reconcile an explicit server-supported Intros/main room mapping with preservation checks, then validate the native candidate with local test data and supported devices. Define atomic mute behavior before adding a whole-community preference action. Continue visual system and remaining screens independently; this package does not block their design work.

The older shared `useAuthUserId` query remains cached indefinitely and needs a separate audit for other consumers. This pass protects the new community query path; it does not establish whole-app account-cache safety.
