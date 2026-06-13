# Feel-pass profiling report (2026-06-12)

Part of the WhatsApp-class smoothness/feel pass. Measured on the iOS sim
(iPhone 17 Pro Max, iOS 26.4) in **dev mode** against prod Supabase. Sim + dev
numbers are directional only; absolute cold-start and FPS must be re-measured on
a physical device at the gauntlet (see checklist at the bottom).

## Cold-start

Measured terminate -> launch -> first interactive feed, timestamped screenshots:

| Phase | Window (dev) | Notes |
|---|---|---|
| Metro JS bundle download ("Downloading 100%...") | ~0-3.0s | **Dev-only.** Gone in production (Hermes bytecode shipped in the IPA). |
| VideoSplash + auth-init gate | ~3.0-5.0s | Branded splash video + the cold-start auth gate. |
| First feed paint (All Plans interactive) | ~5.5-6.0s | First `get_filtered_feed` returns + SectionList renders. |

- **Dev cold-start to interactive: ~6s**, ~3s of which is the Metro bundle download that does not exist in production.
- **Estimated production cold-start: ~2-3s**, dominated by (a) the VideoSplash video length, (b) the auth-init gate (the documented cold-start auth-lock work), and (c) the first feed fetch (`FEED_DEADLINE_MS`).
- **Levers (production):** VideoSplash duration (PROTECTED file; needs explicit approval to touch), the auth-init gate bounding (already hardened separately), and feed-fetch latency. No code change taken here.

## JS FPS while scrolling

A live Perf Monitor overlay could not be enabled headlessly on this setup (the
simulator dev-menu keystroke is dropped without accessibility permission). Rather
than a sim FPS number that wouldn't transfer to device anyway, the JS-thread cost
is characterized below via a static re-render hotspot audit; the hotspots are the
direct cause of scroll/keystroke frame drops. **Absolute FPS: gauntlet, on device.**

## Re-render hotspots (the actionable deliverable)

Ranked by impact. These drive the optimization work in the FlashList/expo-image
commit and a follow-up render-stabilization commit.

### Biggest 5 wins
1. **ChatThread FlatList `renderItem` is a giant inline arrow** (`components/chat/ChatThread.tsx:1811-1872`) + a per-row `onTriggerReply={() => ...}` closure (1846-1853). `ChatThread` re-renders on every keystroke / typing-dot tick / keyboard toggle; the unstable `renderItem` + per-row closure defeat `SwipeableRow`'s memo, re-rendering the whole visible list. **Fix:** extract `renderItem` to a stable `useCallback` reading `enrichedItems` via the existing `enrichedItemsRef` (1598); replace the per-row arrow with one shared `handleTriggerReply(msg)`. Highest feel-impact change in the app.
2. **Plans feed per-card `onWishlist`/`onReport`/`onBlock`/`onCreatorPress` are inline arrows inside `renderItem`/`renderFeedItem`** (`app/(tabs)/plans/index.tsx:1155-1225`). Every save/unsave invalidates `['wishlists',userId]` -> new `wishlistedSet` -> new `renderItem` -> the SectionList re-renders all rows because each row gets fresh handler refs that fail `PlanCard`'s `React.memo`. **Fix:** hoist to stable top-level `useCallback`s (like the already-stable `handleReport`/`handleBlock`).
3. **`PlanCard` replays its `FadeInUp` entering animation on every virtualization remount** (`components/plans/PlanCard.tsx:265`). Cards re-fade each time they scroll back into the window. **Fix:** animate first appearance only; simplest, gate `entering` to `isOptimisticPlanId(plan.id)` so only the just-posted card animates.
4. **ChatThread `enrichedItems` fully rebuilds (`map` + `reverse`) on every reaction/send** (`ChatThread.tsx:1567-1582` + `useChat.ts setMessages`). O(n) per reaction tap on a long thread. **Fix:** isolate reaction state into a `Map<messageId, reactions>` so a single reaction doesn't re-map+reverse the whole array.
5. **Plans grouping pipeline allocates `new Date()` repeatedly in the hot sort comparator** (`index.tsx:382-439`) and carries a dead `now` dep on `myPlansUpcoming/Past` (1010-1023). **Fix:** precompute a numeric `sortTimeMs` per FeedItem during grouping; drop the dead `now` dep.

### Lower-priority
- `formatDateTimeForCard` (Intl, `PlanCard.tsx:464`) + `getPlanPinColor` (`:428`) recompute per card render; negligible once #2 lands (memo bails untouched cards).
- `LinkedText` regex `split` per text bubble (`ChatThread.tsx:207`); protected by memo in steady state.
- `AvatarGrid` cell handlers are inline arrows; `lightUpIds` change re-renders all cells (`components/yours/grid/AvatarGrid.tsx:39-53`). Small grid, low impact.
- Profile (`app/(tabs)/profile.tsx`) is a static ScrollView over bounded `.map()`s; clean, no action.

### Cross-cutting note for the FlashList pass
Both hot lists produce a **new top-level array ref on every micro-update** (RQ
invalidation for Plans; `setMessages` map-replace for Chat). FlashList recycling
cuts render cost but does NOT fix the upstream new-array churn; wins #2 and #4 are
prerequisites for FlashList to pay off. The chat list's inverted +
`maintainVisibleContentPosition` + dynamic image-height combo is the trickiest
migration; budget extra device verification there.

## Gauntlet re-measure checklist (on device, production build)
- [ ] Cold-start to interactive feed (production Hermes, no Metro).
- [ ] JS + UI FPS scrolling a long feed (heavy account); Perf Monitor / Flipper.
- [ ] JS FPS typing in a busy chat thread + while the other party's typing-dots animate.
- [ ] Navigation transition jank (tab switches, push/pop into plan detail + chat).
- [ ] Re-verify wins #1-#5 actually moved the needle (before/after FPS).
- [ ] **Legacy composer H1 forced-failure rollback test** (runs naturally in the flag-OFF bundle this pass uses).
