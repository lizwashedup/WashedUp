# Full conversation: local integration review

The isolated Plan/Circle/DM `ChatThread` now presents its compact context header, conversation, reactions, composer and recovery states together in the accepted cream/Mona/ink/clay system. This extends the existing staged implementation; it does not introduce another chat type or an ordinary-emoji keyboard.

## What changed

- The actual conversation background, date/system rows, quoted messages, loading/empty/error states and retry controls use the staged tokens. The development flag remains off by default. Bottom navigation is untouched.
- Shared reaction chips now cover Plan/Circle/DM as well as community messages. Counts and selected checkmarks remain visible inside 44-point targets. The shared conversation preserves its existing other-author-only reaction policy; the community adapters retain their own policies. Picker and chip changes resolve the viewer's existing stored heart alias. No reaction storage, notification or recipient policy changed.
- Room/account retirement now protects measured Circle/DM menu callbacks and reaction-picker dismissal. The parent Circle route observes account transitions before allowing its delayed navigation/menu continuations.
- Report submission captures the initiating account, target and modal visit. Returning from an old request cannot change a fresh visit. An ordinary successful close keeps the report target mounted long enough for the confirmation to appear; closing/reopening, target changes and account/room retirement invalidate that feedback.
- Interactive photos, audio and maps retain their individual accessible controls instead of being grouped inside a second message button.
- Send/save/record has a named, focusable control and keyboard/accessibility activation. Accessible voice activation opens the existing locked-recording controls without uploading or sending. The physical hold/swipe path remains. Reply/edit dismissal has explicit labels and 44-point targets.

## Actual screen, controlled boundaries

Review: <http://127.0.0.1:8845/?view=conversation>.

This renders the **actual React Native `ChatThread` through React Native Web**, not a separately drawn HTML chat. Local fixture messages, transport, identity, navigation, push, recorder and database boundaries make it possible to exercise the screen without sending messages, reports or notifications, accessing a real account, or creating calendar entries. The fixture's sample people use initials; real profile-photo rendering remains in the source.

The browser keeps the web emoji fallback. Staged iPhone/Android typing uses the native keyboard instead. The preview does not simulate the mobile keyboard, VoiceOver, TalkBack, audio session, APNs/OneSignal or real network transport. The parent screen owns bottom navigation, which is not duplicated in this focused conversation fixture.

Cases use the same component:

- `?view=conversation`: compact event/calendar actions, text, quote, location and reaction chips.
- `?view=conversation&case=send-failure`: one local unconfirmed send returns the text to the composer; retry succeeds in local memory. The real transport's separate native alert is not simulated by this boolean-return fixture.
- `?view=conversation&case=load-error`: failed initial history and functional retry.
- `?view=conversation&case=empty`: invitation and composer, without fabricated history.
- `?view=conversation&case=expired`: readable history and context with disabled reactions and a closed composer.

## Browser findings

At 375×812 and 430×932, the full screen has no horizontal document overflow. The 430-point context target measured 52 points high, with adjacent 44×44 calendar and menu actions. A selected reaction measured 44 points high while its visual surface remained compact. Mona loaded in the composer.

Observed actions: selecting/removing a reaction; opening the existing picker and choosing another emoji; replying to a specific message; sending a local reply and clearing its composer; retaining a draft after an unconfirmed send; retrying that draft into one message; retrying an initially failed history load; activating the event and calendar callbacks locally. Expired history retains its counts and removes the add-reaction/composer controls. The initial integrated pass exposed the nested map button, missing composer accessibility and smaller legacy reaction badges; these prompted source corrections rather than being accepted as finished design.

Evidence: `/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/full-chat-conversation/`.

## Verification and remaining boundaries

The final combined regression run passes **214 tests in eleven suites**: shared entry, Circle menu lifetime, main/topic entry, ReportModal, ReactionChips, reaction aggregation, community companion lifetime, composer media/accessibility and recorder sending. Full no-emit TypeScript and scoped diff checks pass. The local component bundle rebuilt successfully.

The browser verified Enter and Space each submit one local message, clear the composer and expose the newly appropriate recording label. Cancel reply measured 44×44 and preserved the typed draft. These add browser evidence to the native accessibility callback tests; they do not establish physical screen-reader operation. Final layout measurements are saved in `layout-checks.json`, and the final 375/430 normal-screen screenshots use the updated source. The failure/empty/expired screenshots were captured earlier in the same pass before the final accessibility-only controls update.

Detailed contracts: [report lifetime](report-modal-lifetime-2026-09-13.md), [Circle menu lifetime](circle-chat-menu-lifetime-2026-09-13.md), [reaction appearance and integration](reaction-chips-appearance-2026-09-13.md), [composer accessibility](shared-chat-composer-accessibility-2026-09-13.md).

Physical-device keyboard, screen-reader operation, scroll position during native keyboard changes, background return, reconnect, long histories and recording interruptions still need device evidence. Browser geometry and mocked transports do not establish native smoothness or delivery reliability. The Circle child invitation/composer mutations and legacy circle metadata cache need their own account-scope review. No already-dispatched remote write can be recalled by these UI guards. Report receipt/idempotency, durable chat outbox, deployed expiry and provider notification behavior remain separate engineering work.
