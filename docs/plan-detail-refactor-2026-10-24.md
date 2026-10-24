# Manage Plan edit preparation

The plan detail screen previously contained age-preset conversion, date and
content validation, photo normalization, and construction of the database patch.
These responsibilities now live in `lib/planEditDraft.ts`, so the values sent by
the editor can be tested without mounting the screen or mocking its data reads.

The screen maps its existing state to a typed draft and presents the returned
validation message or passes the prepared patch to the existing `usePlanEdit`
hook. `planEditRules.ts` keeps the existing schedule/age/capacity rules; its
return type now describes the actual scalar values instead of `unknown`.

## Scope and source

- Branch: `codex/plan-detail-refactor`, based on local main `fc419a5`.
- Checkout: `/Users/liz/Desktop/WashedUp_HQ/washedup-plan-detail-refactor-20261024`.
- No request, schema, permission, query-key, or save-recovery changes. Native
  testing also corrected a footer text node and date/time accessibility grouping.
- Current-account, visit, closed-plan, departure, empty-title, and editor locks
  remain in the screen and existing save hook.
- Unchanged rules preserve exact stored schedule values on unrelated edits,
  including the second occurrence of an LA daylight-saving fall-back time;
  explicit time changes retain duration. Custom ages remain untouched until
  selected. Circle capacity stays outside this editor's ordinary/Featured rules.
- Unused local month/date-label helpers were removed with the extracted code.

The separate account/push foundation patch was observed as uncommitted work in
`/Users/liz/Desktop/WashedUp_HQ/washedup-foundation-recovery-20261019` and was not
included here. This inspection does not verify the live release state.

## Verification

Before the change, the plan screen, edit hook, and edit-rule suites passed all
166 tests. The final verification covers those suites plus photo handling and
the new edit-preparation suite (197 tests across five suites), and the app-wide
TypeScript check. Tests make no production writes.

New coverage checks validation priority and rejection without a write, draft
retention and correction, midnight/noon and exact minutes, impossible LA times,
custom ages, Circle rules, Featured capacity, blank fields, and photo handling.
Existing screen/hook coverage retains uncertain-save reconciliation and account
ownership behavior. The tests emit the same Expo Go push warning as the baseline.

Commands run from this checkout:

```sh
node node_modules/typescript/bin/tsc --noEmit --pretty false
node node_modules/jest/bin/jest.js --runInBand --watchman=false --runTestsByPath lib/__tests__/planEditDraft.test.ts app/plan/__tests__/plan-detail.presentation.test.tsx app/plan/__tests__/plan-photo-edit.test.ts hooks/__tests__/usePlanEdit.test.tsx lib/__tests__/planEditRules.test.ts
git diff --check
```

Local checks use Node 25.8.1 and the existing dependency installation. The
repository pins Node 20.20.1; pinned-runtime CI, physical-device and live-backend
checks remain release checks. No native build, merge, push, OTA, or production
action was made.

## Native simulator verification

Tested the actual plan-detail screen, edit hook and preparation code on iPhone 17
Pro Max / iOS 26.4 through the existing local development binary. An isolated
harness supplied fictional data and simulated save outcomes; remote service
traffic was blocked. This was a focused Manage Plan test, not full-app or live
backend verification.

Passed normal save, invalid content with draft retention and correction, rejected
save followed by retry, uncertain-save reconciliation without duplicate update,
exact stored timestamp/custom age preservation, invalid minute blocking, explicit
07-minute save with duration preserved, and calendar selection.

Two existing native issues were corrected: literal whitespace directly inside a
footer View caused the native raw-text error; accessible Pressable wrappers
grouped date/time popup controls into one accessibility element. Removing the
raw text and disabling accessibility grouping on those wrappers resolved both
on the simulator. Regression tests cover raw View text and direct minute entry.

Evidence, source hashes, screenshots and test logs:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/simulator-test-results.md`.

## Second checkpoint: editor state

The first tested patch was committed as `ccbb5bc`. The second patch introduces
`hooks/usePlanEditDraft.ts` and its dedicated tests, updates the screen to consume
its typed draft, and adds screen regressions for fresh and uncertain reopenings.
The screen is 104 lines shorter than the first checkpoint.

The hook owns draft values, original snapshot, change flags, age-range selection,
and temporary date/time picker state. It performs no I/O. Account/visit checks,
modal lifecycle, keyboard/haptic effects, location-widget synchronization and
save/photo recovery remain with their existing screen and save-hook owners.
Fresh edits reset from the current plan; uncertain edits skip that reset.

Verification: 205 tests across six suites passed; app-wide TypeScript and
`git diff --check` passed. New cases cover cancelled picker input, minute
confirmation, date selection, age limits, reset of change flags, unsaved editor
reopening, and retained uncertain drafts. The same local iPhone 17 Pro Max / iOS
26.4 harness passed discard/reopen, uncertain close/reopen/check without a duplicate
write, invalid minute blocking, explicit 07-minute entry, changed calendar date,
and save/reopen. Exact original timestamps, ages and capacity were preserved
until intentionally changed. The new date retained the two-hour duration.

Evidence for this checkpoint is under:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/draft-hook`.
The fixture uses a stand-in Places widget; its input displayed a placeholder on
uncertain reopening while the retained draft/payload kept the correct location.
Real Places widget behavior remains outside these tests, as do the previously
listed physical-device, backend and release checks.

Both checkpoints are local only. Before another refactor, review these boundaries
and select the next module based on concrete maintenance needs.

## Third checkpoint: editor presentation

Extracted the form, photo controls, date/time overlays, recovery footer and their
styles into `components/plans/ManagePlanEditor.tsx` and
`components/plans/managePlanEditorStyles.ts`. The existing shared appearance
transform moved verbatim to `components/plans/planDetailAppearance.ts`, used by
both the detail screen and editor. All moved style definitions were checked
against checkpoint `9ce7103` and match exactly.

The screen retains its native Modal and dismissal callback, the alert state,
draft/save hooks, account and permission checks, save preparation, photo requests,
and navigation/cancellation actions. The alert remains a child of the editor
overlay so validation is visible over the native modal. The component does not
own the draft or add a second save path. The screen is 925 lines shorter than
checkpoint `9ce7103` (presentation code was moved, not removed from the app).

Verification: the existing 205 tests across six suites passed, including iOS
cancellation dismissal sequencing, uncertain-save recovery, photo handling,
custom ages, exact timestamps and both appearance modes. App-wide TypeScript
and diff whitespace checks passed. No new implementation-mirroring tests were
needed for this extraction.

The iPhone 17 Pro Max / iOS 26.4 local fixture verified unchanged form appearance,
validation alert layering and draft retention, successful correction/save, native
time controls with exact-minute preservation, and uncertain-save field locking,
recovery footer and reconciliation without a duplicate update. The native cancel
action correctly displayed its separate confirmation after the editor dismissed.
No cancellation was submitted. Evidence and logs are under:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/editor-component`.

### Follow-up found outside this extraction

The existing `PlanDepartureSheet` exposes the cancellation confirmation as one
accessibility element labelled “Dismiss confirmation”, without individual action
buttons. Native automation could view the correct sheet but could not dismiss it
through that element; coordinate control also failed with `noWindowsAvailable`.
The fixture was restarted. The sheet has nested accessible Pressable wrappers,
similar to the earlier picker issue, and is unchanged by this patch. Check and
repair that accessibility boundary separately, including Keep plan and Cancel
plan controls and the existing one-action/dismissal safeguards. Automated
cancellation transition tests pass; full native confirmation interaction remains
unverified.

The existing fixture/physical-device/live-backend limitations still apply.
This checkpoint contains no production changes, dependency changes or deployment.
