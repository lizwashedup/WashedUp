# Shared reaction chips: staged appearance

The actual `ReactionChips` component now accepts the same optional `appearance?: { fonts: AfterglowFontFamilies }` used by other staged chat components. Root integrates this at ChatThread, community and topic callers; this package changes only the component, its tests, and this document.

## Visual and accessibility contract

- Existing `reactions`, `onReact(storageKey)`, `onAddReaction`, `disabled`, `style`, and `children` remain unchanged.
- Staged emoji/count surfaces use the accepted Afterglow font/color constants, a six-point corner radius, and a natural text-driven height. A typical chip is about 30 points tall inside a separate minimum 44×44 touch target. The small visual surface does not reduce the touch area.
- Selected reactions keep their checkmark, selected accessibility state and “your reaction” label. Color is additional information, not the only selected indicator.
- The count uses the staged caption size with medium/semibold font. It has no fixed line count or fixed chip height. Large counts and larger text can enlarge the chip; the row continues to wrap.
- Add reaction retains its existing picker callback and 44-point target. Its staged 28-point inner icon surface matches the visible chips.
- Disabled reactions remain visible with their counts and selected state; the add-picker control remains hidden. Caller-provided child actions and row styles are passed through unchanged.
- Without `appearance`, the existing layout, colors and typography remain unchanged.

## Preserved behavior

`lib/communityReactionChips.ts` is untouched. Its source remains responsible for filtering invalid counts, combining the legacy `heart` spelling with `❤️`, retaining the viewer's actual stored alias for removal, and preserving reaction order/counts. `ReactionChips` continues to call `onReact` with that stored key.

This component does not decide whether one or several reactions are allowed. Main-community messages, broadcasts, topics and ChatThread retain their caller policies and access/lifetime guards. It does not add reaction types, perform storage writes, or change read-only rules.

## Verification

The two new staged-style contracts failed against the previous component; the existing/preservation cases passed. After implementation, **46 tests in three suites pass**, including six actual ReactionChips cases. Coverage includes legacy alias aggregation/callbacks, selected semantics, empty picker behavior, archived/disabled reactions, compact visible surfaces inside full-size targets, untruncated large counts, and preservation of caller children/styles.

```sh
./node_modules/.bin/jest --runInBand --ci \
  --cacheDirectory=/private/tmp/washedup-reaction-appearance-jest \
  components/chat/__tests__/ReactionChips.test.tsx \
  lib/__tests__/communityReactionChips.test.ts \
  components/communities/__tests__/CommunityCompanionLifetime.test.tsx
```

These are actual-component and source-contract tests, not physical-device text-scaling or VoiceOver evidence. Root owns full conversation visual QA and combined typecheck after caller integration. No dependency, backend or production changes were made.

## Actual ChatThread integration follow-up

Root integrated the shared chips into staged Plan/Circle/DM conversation messages. Eleven focused tests were added to `components/chat/__tests__/ChatThreadEntryLifetime.test.tsx`, preserving its 37 existing cases. Its current total is **48 passing cases**.

The new cases verify:

- Real message reactions adapt to counts and current-viewer selection; the `heart`/`❤️` alias sent by both chip and picker stays the viewer's actual stored spelling. Switching viewers updates selection without reusing the previous entry's operation scope.
- Expired chats keep their reaction information while blocking chip and picker writes. Previously captured callbacks remain retired when the chat expires.
- The existing shared ChatThread policy permits reacting to other people's messages. Own-message counts remain visible but disabled, with no add-picker action. This is a caller-specific policy, not a new global community/broadcast rule.
- Retained chip, picker selection, picker opening and picker dismissal callbacks cannot mutate or dismiss the controls of a fresh room/account visit, including account A → B → A.
- Interactive location/photo/audio messages do not acquire a second accessible outer button around their individual media controls. The actual location map button remains accessible. The ordinary text-message button still starts a reply. Photo/audio child components are mocked in this integration harness; their physical accessibility is not established by these wrapper tests.

The first six integration cases reproduced **three failures**: a retained picker `onClose` dismissed a newly opened picker after room change, account change, or account return. Root guarded that dismissal with the initiating entry, and all three reproductions now pass. Root also owns the shared adapter's alias resolution and own-message policy enforcement; this follow-up changed tests/documentation only.

The combined reaction package now passes **94 tests in four suites**:

```sh
./node_modules/.bin/jest --runInBand --ci \
  --cacheDirectory=/private/tmp/washedup-reaction-appearance-jest \
  components/chat/__tests__/ChatThreadEntryLifetime.test.tsx \
  components/chat/__tests__/ReactionChips.test.tsx \
  lib/__tests__/communityReactionChips.test.ts \
  components/communities/__tests__/CommunityCompanionLifetime.test.tsx
```

Root continues to own actual full-conversation browser QA and combined typecheck. No screen or shared component implementation was edited by the integration-test follow-up.
