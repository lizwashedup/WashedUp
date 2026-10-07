# Topic and event chat header — isolated candidate, September 13, 2026

This change ports only the header/context presentation in `app/community-topic/[id].tsx` to the existing `ChatContextHeader`, behind `COMMUNITY_CHAT_GROUPING_ENABLED` (`__DEV__` plus the explicit environment opt-in). The original header/context branch remains when the flag is off. It is a local source candidate, not a release or device-verification claim.

## Presentation and existing actions

- Event rooms display the existing event title (falling back to the topic title), date and venue in the compact identity. The identity opens the same `/event/{explore_event_id}` route. Back still calls `router.back()`.
- Calendar remains conditional on the existing valid start-time/non-cancelled predicate and passes exactly the original event title, start, end and venue to `showAddToCalendar`. It sits beside the existing per-topic notification control.
- A compact secondary strip retains the event audience, completed/cancelled state and exact computed chat deadline. Status and expiry text may wrap; they are not truncated. Photos retains the existing `/event-album/{topicId}` callback and moves to this strip, with a minimum 44pt target. This port does not change the album route's own eligibility rules.
- Persistent topic titles open the existing `/community/{communityId}` route only when topic metadata explicitly identifies a persistent room (`explore_event_id === null`) and provides the community ID. The subtitle uses only the owning community name from the existing membership payload card matched by community ID, falling back to the existing audience copy. Unknown provenance remains a plain identity. Event attendees receive no new community or Join route, including while the payload is unresolved.
- The staged presentation uses only the existing Afterglow tokens and `useAfterglowFonts` fallback. It does not create another Details button or duplicate the event title in a context card.

## Preservation boundary

The same notification element, handler and `useCommunityTopicMute` controller serve both presentations. Checking remains disabled and busy; an unknown setting offers the existing read-only retry; a confirmed muted state exposes Unmute with the unread-history hint. Existing save/readback feedback is unchanged. The staged notification target uses its 44pt bounds without extra hit slop, so it does not overlap the adjacent calendar target; legacy hit slop remains 12. No community-wide mute, event inheritance, delivery promise or sender behavior was added.

No query, source read, membership check, receipt, message schema or transport changed. The say-hi veil, creator welcome, closed/removed-member composer states, moderation, profile, mention, upload and reaction paths remain in their original positions and use their existing gates. The adapter tests retain the welcome/veil and cancellation boundaries; they do not replace the existing broader gate and controller tests.

## Local checks

The new `components/chat/__tests__/CommunityTopicHeader.test.tsx` renders the actual screen and shared header with mocked source reads and actions. Its eleven cases cover event attendee navigation without a community link, actual calendar values, persistent-room navigation and matching community identity, unknown provenance, cancelled status and closed composer, the welcome/say-hi veil, checking/unknown/muted notification states, and the legacy branch.

Command:

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-topic-header-agent-jest components/chat/__tests__/CommunityTopicHeader.test.tsx components/chat/__tests__/CommunityTopicNotifications.test.tsx components/chat/__tests__/CommunityMainHeader.test.tsx
```

Result: **3 suites, 20 tests passed**, exit 0 (11 topic adapter, 5 topic notification screen, and 4 main header adapter cases). The five existing notification screen tests continue to exercise authoritative loading, rapid-tap serialization, unknown read retry, mismatched readback and unconfirmed-result retry through the actual controller.

```sh
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-topic-header-agent.tsbuildinfo
```

Result: **exit 0**. Scoped `git diff --check` was clean. Existing dependencies were used through the existing temporary symlink; no packages were installed or changed. Parent task owns exact-link cleanup.

Remaining validation: native layout with long event titles and larger text, screen-reader behavior, calendar chooser, album navigation, keyboard and safe-area behavior. These local tests invoke mocks and make no real sends, provider calls or backend writes.
