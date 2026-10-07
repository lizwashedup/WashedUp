# Chat emoji and GIF panel · staged review

## Current decision — system emoji keyboard on mobile

Following Liz's question about duplicating the iPhone emoji keyboard and delegation of product judgment, the decision is to use the system keyboard for native emoji entry. The staged iOS/Android `ChatThread` now omits its duplicate emoji-entry toolbar button. The ordinary multiline TextInput, its default keyboard, selection, spelling and correction behavior remain. There is no attempt to programmatically select the OS emoji keyboard. Quick/full message **reactions remain unchanged**.

GIFs move to an optional attachment-menu entry when the existing native SDK bootstrap prerequisites permit it. `MediaPanel` adds optional `mode="gif-only"`; this opens the GIF grid/search directly, without Emoji/GIF tabs, emoji categories, message-backspace controls, or reading/writing emoji recents. The omitted-mode default retains the combined picker for flag-off callers and the staged web emoji fallback. Search, original/fallback GIF URL selection and the existing send callback remain.

`isChatGifPickerAvailable()` requires iOS/Android, the existing build-time key and the existing bootstrap's non-local-only condition. This isolated checkout sets `LOCAL_DEVELOPMENT_ONLY=true` and deliberately does not configure the provider, so its new native attachment GIF entry stays hidden. Tests use mocked capability/provider responses; no provider configuration or live request changed. These prerequisites do not prove SDK initialization or delivery succeeded.

The attachment→GIF transition keeps the same `activePanel` slot, measured panel height, bottom inset and keyboard listener handoff. Its keyboard button focuses the existing TextInput; the panel remains until the keyboard takes over. It does not switch keyboards on the user's behalf.

Final focused verification: **55 tests passed in 5 suites**: 22 MediaPanel, 6 AttachmentSheet, 11 actual ChatThread composer-routing cases, 5 ChatUxContract and 11 shared input-height cases. Full `tsc --noEmit` and scoped `git diff --check` passed. The tests exercise native/web/flag-off prop paths, availability, GIF-only controls/storage, current GIF callback, read-only composer visibility and keyboard handoff callbacks. No physical-device, VoiceOver/TalkBack or provider delivery claim is made.

Earlier emoji-panel browser screenshots and the original review below are **historical web-fallback/legacy evidence**, not the current proposed mobile default. Native keyboard language, emoji layout and selection remain OS/user preferences.

## Original combined-picker appearance review

`components/chat/MediaPanel.tsx` accepts optional `appearance: { fonts: AfterglowFontFamilies }`. `ChatThread` passes it only through the existing `COMMUNITY_CHAT_GROUPING_ENABLED` development branch. The component still owns its existing Emoji/GIF tab, shared search and emoji category state, inside the caller's keyboard-height panel. Height, bottom inset, `onSelect`, `onBackspace` and `onGifSelect` are unchanged.

The staged appearance uses Afterglow paper/ink/clay, the supplied UI fonts, a restrained search field, underline tabs and a horizontally scrollable category row. Search, clear, delete and tab controls have explicit minimum touch dimensions; categories use 48 by 44 points. Clear search returns focus to the same mounted input. Omitting appearance retains the previous visual treatment, aside from the added accessible search label and the preference validation described below.

## Preference defects found and repaired

All appearances now validate stored recents as an array of supported emoji, remove invalid/duplicate entries and keep the existing 24-item limit. A late preference read merges with emoji already chosen in this panel instead of replacing them. The component ignores that read after unmount.

Independent review reproduced a further persistence defect: choosing an emoji before hydration completed issued a storage write containing only that choice. The late merge showed `[chosen, saved]` in memory but did not save it. The new regression test failed with `["😀"]` instead of `["😀","☀️"]`. Root corrected this by persisting the merged list when a choice occurred during hydration; the same test now passes. This proves the intended storage calls, not native transaction ordering across simultaneous mounts.

The existing `chat_emoji_recents` key remains a device preference. This change does not introduce account-scoped messaging state or change storage providers.

## Verification

Independent focused run: **16 MediaPanel component tests passed**. The suite exercises:

- Previous default fonts, delete label and category layout.
- Search remaining mounted, clear restoring focus, emoji insertion and unchanged message-backspace callback.
- Category target dimensions, selected state and restoring the chosen category after searching.
- Six malformed preference shapes, duplicate/invalid saved entries, late hydration with a new pick, persistence of that merge and local selection when storage reads/writes fail.
- Existing native GIF content construction for iOS/Android: trimmed search, trending after clearing, three-column configuration, original-image URL then fallback-media URL callback behavior, and no callback for missing media.
- The existing unavailable GIF view on web and returning from it to emoji selection.
- Caller height/bottom-inset values and staged search/tab/clear/delete target constraints.

The GIF provider is mocked in these tests, with a temporary local test marker for the build-time key; no real Giphy request, account, install or dependency change is involved. Root separately owns the actual-component browser fixture, visual checks and full TypeScript run. Component tests establish the ref's focus call and layout contracts; they do not prove physical-device keyboard transitions, VoiceOver/TalkBack behavior, extreme accessibility sizing, native GIF playback/delivery, or native storage transaction ordering. The native missing-key branch is unchanged; the unavailable state was rendered through the web condition.

No further implementation defect was established in this bounded review. Skin-tone selection remains the source's existing deferred feature, outside this appearance port. The main-community lifetime findings are tracked separately in `main-community-lifetime-audit-2026-09-13.md`.
