# Chat attachment panel · isolated appearance port

## September 13 update — native emoji entry and optional GIF destination

The current staged iOS/Android composer uses the phone's normal emoji keyboard rather than a duplicate emoji toolbar button. Message reactions remain unchanged. To preserve GIF entry separately, `AttachmentPanel` adds optional `showGif` (default false), with action key `gif` and label **GIFs**. The original Photos/Camera/Location handlers remain. With GIFs available, four equal-width targets share the row; labels retain wrapping and 44-point minimum targets. Without it, the original three-column layout remains.

`ChatThread` passes `showGif` only for staged iOS/Android when `isChatGifPickerAvailable()` matches the existing native SDK bootstrap prerequisites. The local-only checkout disables provider configuration, so it does not expose that entry. Missing key and web also omit it; no key, SDK/provider initialization or remote behavior was changed. A real configured native build retains the route; mocked tests exercise it locally.

Choosing GIFs swaps attachment content for `MediaPanel mode="gif-only"` in the same keyboard-height slot. The keyboard return focuses the same input and waits for the existing keyboard-show listener before removing the panel. No interim zero-height panel or new keyboard state machine was introduced. Flag-off composition and web's emoji fallback retain their previous entry.

Latest checks: **6 attachment component tests**, **22 media-panel tests**, and **11 actual ChatThread composer-routing tests** pass. With existing chat UX and input-height contracts, the focused total is **55 tests across 5 suites**. Full TypeScript and scoped diff checks pass. Existing browser attachment images below describe the three-choice/no-GIF variant; earlier custom-emoji screenshots are historical web-fallback evidence, not the proposed native default. Device keyboard behavior, accessibility traversal and provider playback/delivery remain unverified.

## Initial appearance pass and evidence

`components/chat/AttachmentSheet.tsx` now accepts an optional `appearance: { fonts: AfterglowFontFamilies }`. The default stays on the existing palette, font, circular icons and single-line labels. Only the development-gated conversation should opt in.

Root integration in the existing `ChatThread` attachment branch:

```tsx
<AttachmentPanel
  onSelect={handleAttachSelect}
  height={panelHeight}
  bottomInset={insets.bottom}
  appearance={COMMUNITY_CHAT_GROUPING_ENABLED ? { fonts: conversationFonts } : undefined}
/>
```

The staged panel uses Afterglow paper/ink/clay, the supplied loaded or fallback UI font, restrained six-point icon corners, and readable body-size choice labels. Its visible and accessible choices are **Photos**, **Camera**, and **Location**. “Photos” reflects `ChatThread`'s current library picker, which specifies `mediaTypes: ['images']`; this port adds no video support.

Targets have explicit 44-point minimum dimensions and retain the existing 56-point icon areas. Labels can wrap and retain native font scaling without a line cap, fixed row height, or automatic text shrinking. The panel keeps its original inline View/grid/touchable hierarchy, three columns, top/horizontal padding, caller-supplied height and bottom inset. Action keys and callbacks, keyboard replacement, permission handling and native pickers are unchanged. Nothing was added to the production provider or database.

`components/chat/__tests__/AttachmentSheet.test.tsx` covers default appearance, both variants' original callbacks, image-only staged copy, scalable labels/minimum targets, font fallback/loading, preserving mounted controls while caller dimensions change, and returning to default styling. These are rendered-component contract checks. They do not establish physical-device keyboard behavior, VoiceOver/TalkBack traversal, or extreme accessibility-size layout inside every possible keyboard height; those remain part of the device verification pass with the existing panel geometry.

Verification: all five attachment component tests passed; the isolated checkout's TypeScript check and scoped `git diff --check` passed. The component test awaits the icon font's async render, so the final run has no unwrapped React update warnings. No dependency edits or live writes were made.

## Root integration and visual evidence

The optional appearance is wired in `ChatThread.tsx` behind the existing development gate. The temporary actual-component fixture uses the real font hook and panel with300-point height/34-point bottom inset. Local Ionicons asset routing was repaired in the temporary server, not the app. Browser checks at375 and430 show all three icons, no horizontal overflow, and item targets111.66×84 /129.99×84. Photos and Location invoke the existing callback keys in the sample. Proof images are in the design directory’s `verification/native-community/375-attachment-panel.png` and430 counterpart. The fixture is intentionally just the panel plus a review label; it does not simulate a complete live conversation, permissions, keyboard or physical-device larger text.
