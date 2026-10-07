# Plan leave, cancellation and ended states — isolated implementation

This package supports the product goal: make it easy to understand what a plan offers, join confidently, and change your mind without confusing feedback or duplicate requests. The selected cream/ink/clay palette and shared typography reach a compact confirmation sheet.

## Behavior

Leave and Cancel remain different actions: leaving updates only the current viewer’s membership; cancellation updates the creator’s plan for everyone. Both retain the existing writes and system-message payloads. Exact account, event and returned status must confirm the primary write. Known PostgreSQL rejection keeps retry available. Missing, malformed or transport-uncertain results lock another write and expose Check status. Positive fresh-read evidence reconciles the saved state without replaying either the write or announcement. An inconclusive read stays inconclusive.

A confirmed primary result stays successful when the optional chat announcement fails. Whole-Circle plans without an event chat omit the unused event-chat announcement; no new Circle broadcast behavior was invented. Operations belong to the initiating account, plan and focused visit. There is one synchronous shared leave/cancel lock. Current-visit success remains in the same modal until Back to Plans; the action explicitly returns to the existing Plans route. Pending work blocks closing and repeat submission. Creator Manage transitions to cancellation after native iOS dismissal rather than stacking sibling modals.

Future-dated cancelled/completed plans now respect the saved status rule as well as existing time boundaries. They stop advertising open spots and cannot offer Join, ordinary Waitlist, Next time or creator management. Existing members retain their original chat destination. Cancelled plans do not offer Add photos. Joining also rechecks terminal status across authentication and before dispatch.

## Verification and limits

234 targeted tests across seven suites passed, including actual route integration, confirmation lifecycle, controlled transport, account/focus retirement, unknown receipt reconciliation and lifecycle rules. Native and fixture TypeScript passed. Metro built; 66 detail and 29 inherited provider bindings plus 22 fictional transport contracts passed. Screenshots and exact source fingerprints are in the design folder’s verification/plan-departure directory.

Browser checks use actual isolated components and React Query with fictional services at 320/375/430 widths. This is not proof of native iOS dismissal timing, real backend UPDATE/SELECT permissions, notification delivery, durable recovery after remount or cross-device idempotency. Existing SQL and direct writes were not changed. Creator editing, ordinary waitlists/invitations, Circle capacity consistency and remaining supporting routes still need their next package. No real plan, membership, message, assent, invitation, provider or release was changed.
