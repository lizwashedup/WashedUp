# Community reaction presentation slice

September 12, 2026. Local implementation in the isolated `chat-context-slice` checkout. No deployment, production write, schema change or migration.

## Result

Introduction/broadcast cards, ordinary main-community messages and topic messages now use the same `ReactionChips` renderer. It shows every stored emoji with a positive count, wraps additional chips within the message width, and no longer inserts heart/fire/clap controls with zero counts. Each chip has a transparent 44-point minimum outer touch target around a compact visible chip with a 28-point minimum height. The visible chip uses minimum height rather than fixed height, so it can grow with larger text. Each target announces emoji/count and selected/disabled accessibility state. The viewer's reaction also has a check and the existing terracotta selection tokens.

A visible **Add reaction** control opens the existing `ReactionEmojiPicker`, including its search, categories and saved recents. Ordinary main messages use their existing screen-level picker; introduction/broadcast cards open that same picker component locally. Topic messages retain their existing picker. Archived topics show recorded reactions but disable chips and omit Add reaction.

Legacy `heart` displays as ❤️. Mixed `heart`/❤️ summaries combine into one visible count; a selected chip retains the viewer's exact stored key so a tap removes the intended existing reaction. Other emoji, including skin-tone variants, remain distinct. With no existing matching reaction, new broadcast hearts still use raw ❤️ and new topic hearts still use `heart`. Picker failures in topics now reach the existing error alert.

## Preservation and limits

- `BroadcastCard` still toggles each emoji independently. Ordinary main messages still use their existing replacement behavior; topic messages still call the existing single-reaction hook. Own-message reaction permissions are unchanged.
- No database rows are normalized or cleaned up. Counts describe reaction records, not deduplicated people across legacy aliases. If one broadcast viewer already owns multiple aliases for the same displayed heart, tapping addresses one original key; this slice does not silently remove the other record or change the existing main-message replacement policy.
- Existing message loading, context, photos, locations, replies, query invalidation and transport remain in place. Concurrent changes in the two route files were preserved.
- No changes were made to `ChatThread`, `useChat*`/`useTopicChat` hooks, OneSignal, SQL, notification opt-in or sender delivery. Author alerts and consistent mute suppression remain separate engineering work.
- Jest verifies presentation and compatibility in isolation. No native device, VoiceOver/TalkBack or live reaction delivery test was performed. This does not claim complete reaction parity across the whole app.

## Files

- `lib/communityReactionChips.ts`: pure count, display-alias and storage-key compatibility helpers.
- `components/chat/ReactionChips.tsx`: shared accessible renderer using current color/type tokens.
- `components/communities/BroadcastCard.tsx`: shared chips and existing full-picker entry; independent toggle callback unchanged.
- `components/communities/CommunityMessageActions.tsx`: shared chips and picker callback; replacement transport unchanged.
- `app/community-thread/[id].tsx`: visible picker wiring and legacy-key resolution only within reaction regions.
- `app/community-topic/[id].tsx`: shared chips, original-key picker selection, and existing error alert on picker failure.
- `lib/__tests__/communityReactionChips.test.ts` and `components/chat/__tests__/ReactionChips.test.tsx`: arbitrary emoji counts, legacy-key selection, independent selected reactions, topic adaptation, empty/archived states and accessible callbacks.

## Validation

- Targeted Jest: **2 suites, 10 tests passed**, rerun after the compact inner-chip refinement, using the existing test egress block and cache under `/private/tmp/washedup-reaction-jest`.
- Full project TypeScript: `tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-reaction-check.tsbuildinfo` passed with no diagnostics.
- `git diff --check` passed.
- Used the pre-existing dependency tree through a temporary `node_modules` symlink in this isolated checkout; the symlink was removed after checks. No dependencies were installed or changed.
