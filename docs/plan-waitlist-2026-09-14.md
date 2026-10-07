# Plan waitlist — local implementation and verification

September 14, 2026. Isolated native copy and fictional React Native Web preview only.

## Completed

The actual Plan route uses `hooks/usePlanWaitlist.ts` for own-row reads, joining and leaving an ordinary waitlist. Loading and read failure remain distinct from an empty result. The initial account check is inside the synchronous pending lock; repeated taps cannot dispatch overlapping changes. Writes require an exact event/user receipt, and removal also requires the original entry ID. A known rejected transaction preserves its original intended action for retry. Missing, mismatched and transport-uncertain receipts offer read-only checking, with no automatic repeat write. Duplicate insertion reads the existing own row.

Account/plan/focused-visit ownership and read revisions prevent stale responses from restoring old waitlist state, including after confirmed plan joining. Uncertain recovery remains reachable if availability changes or a stale notification is present. A known waitlist rejection does not block joining an open plan. Existing Circle admission and public-capacity rules are separate; ordinary waitlist writes are disabled for Circle plans.

The optional cream/ink/clay presentation uses concise Join waitlist, Leave waitlist, Try again and Check waitlist actions. A confirmed entry explicitly does not reserve a place. The existing duplicate-plan choice and creator opt-out remain; its copy no longer promises unverified notification delivery. Choice callbacks have focused-visit ownership and a single-use opening token.

## Verification

- 266 tests across seven suites pass, including the new controller and actual-route cases, plus adjacent joining, exception, departure, editor and introduction-sheet regressions. The diagnostic run exits successfully without reporting open handles.
- Native and fixture TypeScript pass; Metro builds.
- 75 Plan detail provider bindings plus 29 inherited checks pass. The real route/controller and React Query remain; external services in the preview are replaced with in-memory responses.
- 30 fictional transport contracts pass, including exact own-row insertion/removal, wrong-recipient filters, rejection, read failure and a deliberately missing receipt.
- Browser checks cover 320, 375 and 430-point phone widths. See BROWSER-CHECKS.md and screenshots.

## Remaining scope

These are mounted-controller safeguards, not durable server idempotency or proof of production database policies. Unknown results that do not match a fresh read remain uncertain; no blind repeat is authorized. Native iOS/Android lifecycle, accessibility/large text, real PostgREST receipts, concurrent changes, notification/history behavior and full account journeys still require integration testing. Nothing was deployed and no real membership, invitation, message, database or original checkout changed.

Next package: direct plan invitation acceptance/decline. The current legacy path can mark an invitation accepted before membership is confirmed, and multiple pending invitations need a deterministic scoped read. That package is audited but not implemented here. Broader management/supporting surfaces and device/backend release verification remain.

Evidence: /Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/plan-waitlist
