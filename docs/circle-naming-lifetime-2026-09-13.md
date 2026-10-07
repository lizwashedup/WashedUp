# Circle naming lifetime — September 13

`NameCircleSheet` and `useUpdateCircle` now retain the account, Circle and opening that started an operation. The detail parent still determines whether the viewer may open naming: an unnamed Circle, a current admin, and the existing non-DM rule. The server's existing admin checks remain authoritative.

## Behavior

- A hidden sheet starts no identity read or listener. Each opening owns its draft, selected cover, picker, upload and save. Closing, unmounting, a different Circle, a different account (including A → B → A), or a replacement/retired parent scope prevents earlier continuations from editing the new form or publishing success/error feedback.
- Both picker and Save take a synchronous lock before asynchronous work. Fields and cover controls remain steady during the operation; Cancel, backdrop dismissal and accessibility escape remain available. Dismissal retires the local continuation. It does not claim that an upload or RPC already sent to the server has been cancelled.
- The existing read-only account observer guards each opening. Storage gets a fresh account check before dispatch. `useUpdateCircle` captures all arguments before React Query schedules its mutation function, confirms the initiating account before the RPC, and rechecks the account/entry after awaited work. An account event retires a previous generation synchronously; same-account token refresh does not discard a draft or valid pending save.
- A failed cover upload stops the operation. The form explicitly says that its Circle details have not been saved and keeps the draft and preview for a manual retry. Retrying the same selected image reuses its unique upload path. If upload succeeded but saving the identity was not confirmed, retry reuses the uploaded cover instead of uploading it again. Choosing another image replaces that staged cover.
- Picker failures, account lookup failures and save failures stay visible and retryable. A save error says that the result could not be confirmed; it does not falsely claim that a dispatched server write was rolled back.
- The hook suppresses retired callbacks, stale mutation result flags and cache invalidation. A valid current success preserves the original detail and account-directory invalidation prefixes and the sheet's `onNamed` then `onClose` ordering, subject to the entry still being current after `onNamed`.

## Preserved rules and presentation

Name remains required, description remains optional, and inputs retain their 60/140 limits. Save trims both fields and sends an empty description as null. The existing cover add/change/remove behavior and new-cover precedence are retained. The RPC is still `update_circle` with the original identity and clear-cover arguments.

Persistent required/optional field labels, 44-point controls, a capped scrollable sheet and keyboard tap handling make those same actions reachable. The optional Afterglow presentation is provided by the parent integration; the legacy default remains available. Native keyboard layout and screen-reader behavior still need device verification.

The optional `scope` prop accepts `{ userId, isCurrent }`, compatible with the other Circle and community operation scopes. An explicit null holds work; an omitted scope remains usable with the hook's account and mount checks. Parents that need navigation/permission retirement should provide their stable entry scope. Ordinary metadata refresh must keep that scope stable to preserve the open draft.

## Verification

The focused local package passes **55 tests across two suites**: 32 actual `NameCircleSheet` component cases using the real update hook, and 23 direct hook cases using a real QueryClient. Synthetic account, picker, storage and RPC responses exercise both success and failure continuations. Full TypeScript and scoped whitespace checks also pass.

The original sources were captured before edits and substituted through a temporary Jest transformer. Three selected original-sheet cases reproduced duplicate picker calls, duplicate uploads and silent partial saves after upload failure. Five selected original-hook cases reproduced unsafe account/retained-handler/ABA/duplicate behavior. These are local regression reproductions, not a count of production incidents; the working sources were never reverted for comparison.

- [Current focused test log](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-naming/tests.log>)
- [Original sheet reproductions](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-naming/sheet-baseline.log>)
- [Original hook reproductions](</Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/circle-naming/hook-baseline.log>)

Run the focused checks with:

```sh
node_modules/.bin/jest components/circles/__tests__/NameCircleSheet.lifetime.test.tsx hooks/__tests__/useUpdateCircle.lifetime.test.tsx --runInBand --ci
node_modules/.bin/tsc --noEmit
```

No production write, provider/auth setting, migration, installation, release or commit was made. A cover uploaded before dismissal may remain in storage without being attached to a Circle. Durable cancellation, cleanup and server-side idempotency/reconciliation are separate concerns; this package only retires local work before the next dispatch and suppresses obsolete results.
