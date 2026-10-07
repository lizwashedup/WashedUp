# Circle identity and leave integration — September 13

The existing unnamed-Circle naming flow now preserves the draft and photo when an upload or save fails, offers explicit retry, and retires late callbacks after dismissal, room change, access loss or account change. Upload success is retained within the current visit so a later save retry reuses the same cover rather than uploading it again. Naming permissions, description limits and the existing cover-clear/new-cover precedence remain.

The detail parent supplies naming authority that includes current admin/unnamed/non-DM eligibility. It stays stable during ordinary metadata refresh but retires after authority is lost. The same readable entry scope reaches the leave hook. Detail leave completion uses `mutateAsync` with matching-attempt cleanup, so an obsolete identity preflight cannot permanently block a later leave attempt.

The Chats list now removes a Circle/DM row only after a current confirmed `left` or `not_member` response. Failed and malformed results preserve the row. Confirmations, duplicate taps, delayed errors and account A → B → A are scoped; old attempts cannot remove a new viewer's row or close a newer confirmation. The existing inbox fetching/auth path is unchanged; the leave action uses a separate read-only observed identity and requires it to match the inbox's cached identity. This does not establish account isolation of the whole legacy inbox.

The naming sheet has an opt-in Mona/cream/ink/clay appearance wired only through the staged development flag. Name/description labels remain visible, close/photo/remove/save controls retain at least 44-point targets, and a scrollable body keeps the save action reachable on short screens. The existing cover placeholder accepts optional staged typography/colors while all other CircleCover callers retain their prior defaults. Existing bottom navigation and global fonts/colors remain.

## Verification

**145 checks in seven suites pass**: 44 leave-hook, 23 update-hook, 32 naming-sheet, 20 detail-parent, 16 inbox-leave, 6 inbox-grouping and 4 BrandedAlert checks. Hooks use real QueryClient with synthetic auth/transport; the naming suite uses the actual update hook. Full `tsc --noEmit --pretty false` and scoped whitespace checks pass.

The actual component was inspected through the safe local React Native Web harness at 375/430 widths and at 320 × 500. A synthetic cover failure retained the name, description and selected image; retry completed successfully; reopening showed a clean form. At the short size, the body scrolled to the retry button while the close control remained visible. This is browser evidence, not native keyboard, screen-reader or production-storage proof.

- [Review](http://127.0.0.1:8843/circle-identity-review.html)
- [Naming internals and baseline reproductions](circle-naming-lifetime-2026-09-13.md)
- [Leave internals and baseline reproductions](circle-leave-lifetime-2026-09-13.md)
- Saved test log and screenshots: Design/Shared Experience - Round 1/verification/circle-identity/.
- Safe fixture source snapshots are saved beside the evidence. The active local harness remains /private/tmp/washedup-community-review; run its build.cjs with existing dependencies to rebuild.

## Boundaries and next action

No production release, database mutation, real photo upload, account change, message or provider operation occurred. Existing Circle RPCs, history and membership semantics remain. Already-dispatched remote writes cannot be recalled by local guards. A cover uploaded before dismissal can remain unreferenced; storage cleanup and authoritative reconciliation remain separate work. Native keyboard/large text and actual device behavior still need review.

This completes the naming/leave-internals gap called out in the prior Circle workflow package. Next: source-backed Circle noticeboard/directory visual parity (identity, people, upcoming plans and existing routes), while keeping the reserved Room feature unbuilt. Continue native/device chat checks when the documented control path is available; do not repeat the same blocked simulator attempts.

## September 13 copy refinement

Use **Save** for the naming sheet action: it saves the name, optional description and optional cover together. “Save the name” understates that action. Keep concise, familiar action labels; put warmth and explanatory detail in surrounding copy, and make errors describe the actual outcome and next step. This is a wording-only refinement; save, retry and permission behavior are unchanged.

Verification for the copy refinement: all 32 existing `NameCircleSheet.lifetime` checks pass. The safe local React Native Web bundle was rebuilt successfully from the current component/COPY source, so refreshing the linked review shows **Save**. No new test was added for wording alone.
