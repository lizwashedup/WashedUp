# Native community chat visual system

Local implementation candidate, September 12. The community directory and matching outer inbox remain behind the existing development-only grouping flag. No release or data migration was performed.

## What changed

The directory now uses the reviewed cream, ink and clay palette with Mona Sans-derived static font instances. Its community image and name lead into a compact conversation list. Rows show the original conversation title, latest message, timestamp and one unread badge. Event shortcuts use the same original event-room identity. Long names can wrap; previews truncate without pushing badges off screen.

This ports the existing browser design into native components. It does not replace the original combined introduction/conversation history with a fabricated Intros room. Source names and keys remain intact until the separately documented preservation transition is implemented. A whole-community mute control still requires its server contract; the native directory points to working per-chat controls and makes no Mute all claim.

`AfterglowColors` in `constants/Colors.ts` and the Afterglow exports in `constants/Typography.ts` are opt-in. Legacy tokens, the existing bottom navigation, membership gates and notification preferences retain their current behavior. The gated outer inbox now uses the same `ChatInboxRow` presentation for community parents, joined events, plans and circles/DMs. Native adapters retain the original routes, independent event rows and circle-only long-press behavior. The flag-off branch keeps the prior appearance. This is a staged chat rollout, not the entire app's typography rollout.

## Font provenance and loading

The source is the same Mona Sans v2.0.27 file as the browser review. `assets/fonts/afterglow/manifest.json` records its SHA-256, the four pinned axis combinations and generated file hashes. The local build script is `scripts/design/build-chat-fonts.py`; source copyright and OFL are retained. The generated instances have distinct WashedUp family/PostScript names because Mona Sans is a reserved name.

[Expo's font documentation](https://docs.expo.dev/develop/user-interface/fonts/) recommends static fonts for support across platforms. The four local assets total approximately 435 KB and load only when the staged chat surface is enabled and mounted. Loading or font failure uses existing UI fonts and does not block opening chats. These assets have not yet been checked on an iOS or Android device.

## Verification

- Full noEmit TypeScript and `git diff --check` passed after the component changes.
- The directory, outer Chats, projection and account-scoping suites, plus the shared-row accessibility checks, passed 31 tests. They preserve existing room identities, prevent event counts becoming community counts, retain nonmember event access and reject stale account results. These behavioral suites mock font loading; the real loader was inspected in the browser separately.
- A local Metro build renders the actual native components through React Native Web with sample data. At 375 points, the page had no horizontal overflow; Back is 44 points high and conversation targets are 94 points high. At 430 points, the long community name wraps while rows, preview text and badges remain usable.
- Browser checks confirmed the actual custom fonts and images loaded, and tapping After Glow returned its original `room-main` key. No request was sent to Supabase or a notification provider from this harness.

Visual proofs are in the design workspace's `verification/native-community/375-directory.png` and `430-long-name.png`. The screenshot compositor mishandles cropped captures, so these are full browser captures containing the measured phone-width component. The temporary review harness is `/private/tmp/washedup-community-review` on localhost port 8845; it is not a production app build.

## Remaining validation

Real-device font rendering, Dynamic Type, VoiceOver/TalkBack, large histories, scrolling and keyboard behavior still need device validation. The directory alone cannot establish those. Continue the conversation visual rollout in stages, and complete the Intros/main server model and delivery-time mute enforcement before a live transition.

## Outer inbox verification

The matching inbox heading, horizontal underline filters and shared rows are implemented in the same development-gated candidate. The source screen preserves the real ProfileButton and the bottom navigation; the offline component harness substitutes a sample Profile button to avoid account/network reads.

At 375 and 430 points, the real native presentation components rendered with the local custom font assets and no horizontal overflow. Filter touch targets are 44 points; rows are at least 94 points and grow for a long title/date. Browser accessibility inspection confirmed the active filter is selected. The full unread count, preview, contextual community and event timing remain in the accessible row label even when the visual preview truncates. Counts over 99 render as 99+ without changing the accessible count.

A peer review found and corrected a decorative-initial scaling issue: the initial inside a fixed image tile is now non-scaling and hidden from accessibility; the actual title, preview, metadata and badge remain scalable. Physical-device Dynamic Type checks remain outstanding.

The source-screen tests verify the event route, circle/DM route, community-event topic route, one parent opening its existing directory, and the old direct community route when the development switch is off. The sample browser flow also opened After Glow's original `main-room` identity. These are navigation checks, not permission or delivery claims.

Visual proofs: `verification/native-community/375-inbox.png` and `430-inbox.png` in the design workspace. The fixture has sample names/messages; it is not production data. The browser harness uses the actual shared presentation and directory components; native source-screen routing is covered separately by component tests.
