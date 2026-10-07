# Community and event message entry

Isolated development candidate. The existing chat redesign flag selects one shared `CommunityChatComposer` for main community rooms and topic/event rooms. Flag-off retains the original composer. This is not a production release or a claim that the whole chat redesign is complete.

## Presentation

- Photo, location and send each have a 44-point target, with no overlapping hit slop. Icons retain text labels for assistive technology.
- The accepted Mona typography is used at 16/22 for typing. The cream tray and white field use the existing Afterglow palette, with restrained six-point corners.
- The field begins at 44 points, grows for multiline drafts to a maximum of 120, and then scrolls internally. The send control distinguishes send, saving an edit and busy states. No send status claims delivery to another person's device.
- Native measurement uses TextInput content-size events. RN Web measures the textarea at natural height after a value/font/layout change, avoiding a scrollHeight feedback loop when a fixed-height field is cleared. Web measurement is guarded by platform and never accesses native refs as DOM nodes.

## Behavior retained

Each screen still owns its draft, selection and mentions, send handler, photo upload, location modal and admission/expiry gates. Their original input callbacks were lifted unchanged into shared props. Main keeps its keyboard accessory and 4,000-character limit. Topic keeps its typing indicators, first-message introduction placeholder, reply/edit context and original separate photo/location disable conditions. The composer does not provide an automatic offline outbox, create rooms or change membership.

Plan/Circle/DM has additional voice/emoji/attachment-panel gestures, so that composer remains a separate pending adapter; it was not replaced by this simpler component.

## Verification

Seven focused suites pass **36 tests**: shared composer (4), main adapter (5), topic adapter (11), topic notification screen (5), shared header (3), Plan adapter (3) and existing UI contract (5). The composer tests cover callback/selection/keyboard forwarding, disabled/busy actions, editing and resize callback behavior. Full source TypeScript passes. Independent review found no material integration regression in the shared component or either gated screen.

The actual header and composer were inspected in a local React Native Web fixture at 375-point width. All utility targets measured 44×44. The input measured 217 points wide, grew to 120 for six lines, then shrank to 44 when shortened. No horizontal page overflow was present. The buttons invoked sample callbacks only; no messages, uploads, locations or calendar entries were sent.

Proof: design workspace `verification/native-community/375-community-controls.png`. This is explicitly a controls-only fixture. Full device keyboard, orientation, larger accessibility text, real attachment upload and conversation scrolling remain to verify before release.

## Shared sizing follow-up

The proven input sizing is now extracted to `hooks/useChatInputHeight.ts` and shared with the staged Plan/Circle/DM adapter. Main/topic retain the 120-point cap; Plan/Circle/DM retain100. Web alone receives the one-row hint; iOS/Android leave `numberOfLines` undefined so native multiline content can grow. Eighteen focused hook/component cases pass, including native no-line-cap and web grow/shrink behavior. Full TypeScript passes. See `docs/plan-chat-composer-adapter-2026-09-13.md` for preserved voice/keyboard/selection constraints and remaining physical-device checks.
