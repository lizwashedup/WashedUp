# Community main-room header

Isolated development candidate. No production publish, notification send or membership change.

The native main room now uses the same compact context header as Plan/Circle/DM in the existing development-gated redesign. It retains its separately named room, such as After Glow, and shows the community name beneath. The identity opens the original community route; Back still invokes the original router.back callback. The main stream, other rooms and event chats keep their original IDs.

The existing authoritative mute controller occupies a 44-point utility on the right. Checking is disabled, an unknown setting offers a read retry, and a confirmed mute shows both its icon and the existing explanation that unread messages remain. This adapter does not implement the pending parent-community mute contract or claim server push enforcement.

The existing upcoming event becomes a compact, unrounded row below the header. Its original event callback, title, date and venue remain, with full metadata available to accessibility services. It is not a new calendar/invite action. The removed-member gate, photo/location actions and original message/composer functionality remain below.

Flag-off retains the legacy header and pinned-card presentation. The offline banner was also corrected for both presentations: this source sends on request and reports unconfirmed sends; it does not provide an automatic reconnect outbox. The text now directs people to reconnect and retry. A draft survives this UI state.

## Verification

- Five main-screen adapter cases cover original community/event/back navigation, independent room naming, all mute display states, removed-member restrictions, legacy presentation and offline draft/retry messaging.
- Shared context-header tests additionally verify that missing context is readable without a dead button, and the default Plan/Circle/DM back action is retained.
- Independent read-only review found no material issue in the main header and pinned-event integration.
- The actual shared presentation was inspected in a 375-point React Native Web fixture with loaded fonts: back/mute targets 44×44, identity 271×52. The fixture mute action changes only sample state. Proof: design workspace `verification/native-community/375-main-header-muted.png`.

The screenshot is a header-only component fixture, not a logged-in device conversation. Device keyboard, touch/scroll behavior, the full message/composer appearance, automatic delivery/reconnect behavior and the server-backed Intros transition remain separate work.
