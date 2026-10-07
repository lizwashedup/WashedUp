# Report modal submit ownership — September 13, 2026

This is an isolated native client reliability repair. No production reports were submitted. The report schema, six reasons, insert fields, existing copy, and reporting availability in expired conversations are unchanged.

## Demonstrated failures

Actual `ReportModal` component tests with deferred, mocked `getUser` and `reports.insert` reproduced seven failures before the repair: two retained submit callbacks started two auth reads; delayed auth adopted a replacement account; a target A → B → A read still inserted; a selected reason carried into another event; an old insert failure appeared over a new target; delayed success appeared after reopening; and account A → B → A did not retire the original insert completion. Two original success/retry cases passed in that baseline.

## Implementation and caller contract

`components/modals/ReportModal.tsx` now exports `ReportOperationScope`, with `userId: string` and `isCurrent: () => boolean`, and accepts `scope?: ReportOperationScope | null`. A provided scope must capture the readable room/account visit, including account epoch and room admission where applicable. Keep its object identity stable for that visit. Explicit `null` holds reporting while identity is unknown; dismissal remains available. Reporting does not use composer write permission, so expiry alone does not remove the existing action.

The modal owns a separate committed visit for visibility, target user, event, supplied scope and observed account revision. A synchronous attempt ref guards duplicate submissions and back/close during a pending submission, including callbacks retained before a render. Reason selection and pending state belong to that visit. Checks after `getUser` prevent a scoped submission from adopting another account; the insert fixes the initiating reporter ID and retains all existing fields. Checks after the insert and exact-attempt finalizers prevent retired success, failure or cleanup from changing another visit.

A local read-only auth listener performs no asynchronous auth call inside its callback. It invalidates account transitions immediately, including A → B → A between renders; same-account token refresh does not retire a report. Cleanup unsubscribes. Unscoped callers retain the existing single submit-time `getUser` request and payload; once identity is observed or read, account transitions are guarded. Without a supplied initiating scope or prior observed identity, an unscoped legacy caller cannot prove which account was current before its first auth read. Chat callers should supply the scoped API.

The existing delayed success alert can cross exactly its own successful visible → hidden transition. Reopening, another target/event/scope/account, or unmount cancels it. The timer is installed before `onClose`, allowing even synchronous unmount to cancel it. The parent must keep `ReportModal` mounted, with its same target and `visible={false}`, for that child-owned alert to appear. Clearing a conditionally rendered target on close still unmounts the child and therefore intentionally suppresses its alert. Root owns the three chat caller changes to keep the target while hidden and clear it at entry retirement; those changes are outside this component-only package.

## Validation

24 actual component tests pass in `components/modals/__tests__/ReportModal.lifetime.test.tsx`. They cover the seven reproductions plus original schema/retry compatibility, hidden/unknown scope behavior, retained input/close callbacks, synchronous manual close, scope retirement without a render, auth/insert resolution after unmount, timer cleanup, account changes while hidden, visible-alert retirement, old finalizer versus a newer pending request, same-account refresh, signout/sign-in and retryable identity failures. React Native controls and the actual modal component render; Supabase and the alert display boundary are mocked. The repository test setup blocks network egress.

Commands completed successfully:

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-report-modal-agent-jest components/modals/__tests__/ReportModal.lifetime.test.tsx
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-report-modal-agent.tsbuildinfo
git diff --check -- components/modals/ReportModal.tsx components/modals/__tests__/ReportModal.lifetime.test.tsx
```

The existing preserved dependency symlink was used without installs or dependency changes; root retains cleanup ownership.

## Limits

This client ownership check cannot undo an insert already dispatched, bind server authorization atomically to the local scope, or establish moderator receipt/review. Existing report transport has no new idempotency key or receipt lookup; an insert error can have an unknown server outcome, and a later manual retry can duplicate a committed report. The current failure copy and email fallback are retained. No automatic retry, provider change, database mutation outside mocked tests, or device verification is claimed. Non-chat legacy callers require their own scope integration for room/account guarantees before their first identity read.
