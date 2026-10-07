# Compact native conversation header

Isolated development candidate, September 12. Uses the existing local-only chat redesign switch. No production publish or change to room membership/notification policy.

## Source-backed change

The Plan/Circle/DM header now makes the identity itself open the existing context callback. The separate outlined View Plan/View person/View circle control is redundant and disappears only in the staged branch. Back retains the exact existing replace-to-Chats destination.

Plans pass the existing calendar callback into the right-hand header utility. Date and venue occupy one secondary line; the original duplicate date/calendar banner is hidden in the staged branch. A long title has up to two lines, while the accessible identity retains its full name, date and venue. The chevron and action targets cannot shrink under a long title.

The report/block menu remains. Circle/DM keeps its existing measured plus-button ref, menu anchor and dismissal sequencing. Member/profile access, ticket banner, parent organizational-event link, countdown/read-only state and pinned footer remain. The member preview is capped by its existing query; this port does not mislabel that preview as the full attendance count.

The shared header and member-row typography use the accepted local font assets. Conversation bubbles/composer remain separate ports. Community/main/topic headers were subsequently extended in the September 13 packages. No new generic Details page, native share/invite action or unverified join action was added by this package.

## Files

- `components/chat/ChatContextHeader.tsx`: shared presentation and 44-point utility target style.
- `components/chat/ChatThread.tsx`: opt-in adapter over existing callbacks and measured menu ref.
- `app/(tabs)/chats/[id].tsx`: existing calendar callback/location metadata; preserves tickets and parent event.
- `constants/Typography.ts`: the context-title token.
- `components/chat/__tests__/ChatContextHeader.test.tsx` and `PlanChatHeader.test.tsx`: action/adapter preservation.

## Verification

The two new component/adapter suites plus existing ChatUxContract pass 10 tests. The tests exercise context/back/calendar callbacks, preserve member and ticket/parent-event paths, retain flag-off calendar placement, and keep the load-error gate before conversation actions. Source TypeScript and scoped diff checks pass.

A local React Native Web fixture renders the actual shared header with sample metadata. At 375 points, the normal header is 65 points high, excluding status area, members and optional banners; its long-title case is 84 points high. Back/calendar/menu have 44×44 targets. The title target is at least 52 points high. Browser checks verified font loading and no horizontal overflow. Calendar action was invoked only against a fixture callback; no calendar entry or external invitation was created.

Proofs are in the design workspace's `verification/native-community/375-context-header.png` and `375-context-long-title.png`. This is explicitly a header-only fixture, not a screenshot of an integrated device conversation. The fixture's utility glyphs stand in for the app's existing Ionicons; native icon/font loading and full keyboard/list layout still require device verification.

## Next work

Community main and event-topic adapters are now documented separately in `community-main-header-2026-09-13.md` and `topic-chat-header-2026-09-13.md`. Event topics still lack a direct community action; eligibility must be verified before exposing a restricted community's identity/link. Complete native invite/share support against real eligible recipients and URLs before showing a send control. Continue the shared message/composer visual work without changing chat gates, reactions, receipts or storage.
