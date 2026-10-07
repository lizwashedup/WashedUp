# Share plan — isolated optional appearance

`SharePlanModal` now accepts the same optional `appearance?: { fonts: AfterglowFontFamilies }` as the main composer. Its existing callers retain the legacy presentation unless they opt in.

The staged screen says “Share plan” and “Send the link to someone who might want to come.” It retains the title/URL preview, native share action, and existing close/destination callback. “Share link” opens the native share menu; “View plan” is the posted variant's existing destination, while “Open chat” remains the joined variant's destination. It does not repeat the posting celebration or display the legacy growth plea. The optional invitation warning says the request could not be confirmed; it does not claim notification delivery or feed eligibility.

The existing URL contract remains: `/plans/{slug}` when supplied, otherwise `/e/{planId}`, otherwise the site root. Native sharing still receives only `{ message: title + '\n' + url }`; there is no separate URL argument, no delivery/copy success claim, and no automatic sharing. Closing or native dismissal never reports a successful share. Current native-share errors get a plain retry message in the staged screen.

The cream/ink/clay/Mona presentation uses four-point controls, at least 44-point close and 48-point action targets, full wrapping preview content and a vertically scrollable screen with safe-area bottom padding. A synchronous per-visible-plan lock prevents two rapid Share dispatches. A closed, replaced, reopened or unmounted visit cannot start sharing through a retained callback; late native errors cannot replace a newer screen's state. The callback lock also prevents repeated destination/Close calls within one visit. These are local UI lifetime guards, not provider changes or guarantees about a share already opened on the device.

Verification: the new 10-case share suite passes. A combined run of SharePlanModal, both composer people controls and the parent's PostConfirmation suite passes **44 tests across four suites**. Full TypeScript and scoped diff check pass. Root owns browser/real-device verification. No actual external share, invitation or account operation was performed.

Files changed: `components/modals/SharePlanModal.tsx`, `components/modals/__tests__/SharePlanModal.test.tsx`, and this note. Main composer appearance wiring is owned by the main composer agent.
