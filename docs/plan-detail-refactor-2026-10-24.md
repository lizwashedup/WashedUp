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

## Fourth checkpoint: cancellation accessibility follow-up resolved

`components/plans/PlanDepartureSheet.tsx` now marks the backdrop and inner card
Pressables `accessible={false}`. These layout/touch wrappers no longer combine
the heading, explanatory text and action buttons into one native accessibility
element. Removed the backdrop's obsolete accessibility label; explicit Keep plan,
Stay or Close buttons provide dismissal. Backdrop touch dismissal, accessibility
escape, modal isolation and every action/busy/recovery handler are unchanged.

Native verification on iPhone 17 Pro Max / iOS 26.4 now exposes the heading,
Cancel plan and Keep plan individually. From Manage Plan, the confirmation
appeared after modal dismissal. Keep plan returned to the active detail with
zero cancellation attempts/writes. Reopening from the detail cancellation link
and confirming produced one cancellation attempt and one write in the fictional
backend. The success state exposed Back to Plans; activating it dismissed the
sheet and invoked the existing navigation callback (routing is stubbed in this
fixture). The real app's cancellation action was never sent to a live backend.

153 tests across PlanDepartureSheet, usePlanDeparture and plan-detail presentation
passed, including busy locks, retired callbacks, uncertain-outcome checking,
exactly-once exit and iOS dismissal sequencing. App-wide TypeScript and diff
whitespace checks passed. Native accessibility-tree interaction verifies the
reported issue; this is not a full VoiceOver or physical-device audit.

Evidence, screenshots, source hash and logs:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/departure-accessibility`.
The previously recorded cancellation-button accessibility follow-up is resolved
locally. Production, release and other fixture limitations remain unchanged.

## Fifth checkpoint: detail styles

Moved the four remaining static style blocks (detail, join, ticket prompt and
duplicate sheet) to `components/plans/planDetailStyles.ts`. The screen imports
those definitions and retains its existing appearance selection. The four style
blocks match checkpoint `2b02102` exactly; module-level window-width measurement
is preserved. Removed an unused hero-height constant and obsolete comments.
The screen is 837 lines shorter; no state, interaction or data path changed.

Verification: all 126 plan-detail presentation tests passed, covering existing
appearance modes and editor/navigation behavior. App-wide TypeScript and diff
whitespace checks passed. The existing local iPhone 17 Pro Max / iOS 26.4 fixture
rendered the detail screen with its hero, title, age/category metadata, creator
note and fixed action area intact. This native smoke check covered the fixture's
current appearance; alternate appearance coverage is automated, not a new native
visual acceptance.

Source hashes, test logs and screenshot:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/detail-styles`.
All prior fixture, live-backend, pinned-runtime and release limitations still apply.

## Sixth checkpoint: plan and attendee data loaders

Moved the existing `fetchPlanDetail`, `fetchMembers`, and their response types
into `lib/planDetailData.ts`. Both loader bodies match checkpoint `7c5e656`
exactly. Supabase selections, RPC order, response normalization, profile-error
handling and fallback behavior are unchanged. The screen retains account-scoped
query keys, enablement, caching, lifecycle and accepted-People handle visibility.

Added 12 direct tests in `lib/__tests__/planDetailData.test.ts`: public-only creator
projection, exact timestamps/defaults and explicit false/zero/custom bounds,
optional creator failure, primary read failure, reveal-name/avatar mapping,
successful empty reveal, unavailable/malformed reveal fallback, public read errors
and successful empty public results. These exercise the existing read contract,
which the screen presentation mock does not directly execute.

138 tests passed across the data-loader and screen suites (12 loader + 126 screen),
with the corrected null/empty-array parameter table rerun independently. App-wide
TypeScript and diff whitespace checks passed. The local iPhone 17 Pro Max / iOS
26.4 fixture successfully loaded plan detail, four attendee entries and creator
management controls through the real extracted loaders against fictional data.
This verifies wiring; live Supabase permissions/RPC behavior is not newly verified.

Evidence, source hashes and logs:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/detail-data`.
No query behavior, schema, permissions or release configuration changed.


## Combined branch review

Reviewed the complete change from baseline `fc419a5` through `7870246`, including
editor state/reset behavior, validation and patch preparation, component callback
wiring, modal dismissal, save recovery, account/visit ownership, data queries and
appearance extraction. No blocking regression was identified within this scope.
The final cleanup removes trailing blank lines from `planDetailAppearance.ts`
and `planDetailData.ts`; it makes no runtime change.

A TypeScript AST comparison confirmed that both extracted loader bodies, the
appearance function and all six moved style definitions match the baseline
exactly. Query scope and enablement remain in the screen; edit/departure mutation
hooks and service implementations are unchanged by this branch. Existing style
literals were moved verbatim rather than introducing a separate design change.

Combined verification: 9 suites, 244 tests passed; app-wide TypeScript exited 0;
cumulative `git diff --check fc419a5` passed after the whitespace cleanup.
The combined run covers detail presentation, photo editing, edit/departure hooks,
draft state, edit preparation/rules, departure presentation and the data loaders.
No additional native run was needed for the final whitespace/documentation-only
cleanup; native evidence for each preceding checkpoint is linked above.

This is ready for integration review, not production acceptance. Live Supabase
permissions/RPC integration, the actual Places widget, complete app navigation,
full VoiceOver/physical-device checks and the pinned Node 20.20.1 CI environment
remain outside the local fixture evidence. The combined run used Node 25.8.1.
The earlier fixture location-display limitation remains recorded. Stop further
mechanical extraction here and complete integration checks before expanding the
refactor to another screen. Nothing was pushed, merged, built or deployed.

Combined logs and source hashes:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/combined-review`.


## Integration follow-up: location display and recovery

Replacing the location stub with the actual installed Google Places autocomplete
widget reproduced a concrete display defect: closing and reopening an uncertain
save showed a blank location even though the draft and pending patch retained it.
Fresh opens also relied on a 100 ms timer to populate the visible text. Two new
regressions failed before this fix and passed afterward.

`ManagePlanEditor` now supplies `draft.location` as the widget's text-input value.
Removed the imperative Places ref, its prop plumbing and delayed initialization
from the screen. Display and save preparation now read the same retained draft.
Typing still clears old coordinates, selecting a place still sets its name and
coordinates together, and the existing save/account/visit guards remain intact.
No backend query, schema, permission or routing behavior changed.

Five tests render the actual installed widget inside the real detail screen:
immediate saved-place display, selection/save, typing after selection, fresh
reopening from updated query data, and uncertain-save reopening/checking without
a duplicate update. Only place results are supplied as fictional predefined
entries; remote autocomplete search is not exercised. All 186 tests across the
screen, edit hook, draft hook and preparation suites passed. App-wide TypeScript
and diff whitespace checks passed.

Native verification used the existing iPhone 17 Pro Max / iOS 26.4 development
binary with the actual widget and fictional predefined results. Selecting Fixture
Cafe saved its name with latitude 34.01 and longitude -118.49. Typing Integration
recovery cafe cleared those coordinates; an uncertain save retained that visible
text after close/reopen, locked editing, and ignored a place-result tap. Check
changes reconciled the save and refreshed detail. Evidence records exactly two
updates across the normal and uncertain cases, with no extra update on checking.
This resolves the earlier fixture location-display limitation.

Evidence, failing-before and passing-after logs, source hashes and screenshot:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/location-integration`.
The existing navigation callback tests passed in the screen suite. Full router
journeys, remote Google responses and live Supabase integration are still open;
this fixture uses stubbed routing and an in-memory backend. The integration pass
focused on fixing and verifying the reproduced location defect before broadening
those checks. No build, push, merge, OTA or production write occurred.


## Full-app navigation verification

Adapted the preserved full-app fixture to this checkout. It imports the real
ExpoRoot, route tree, app/tab layouts, Plans feed, detail, chat, waitlist and Post
screens. Unlike earlier focused fixtures, Expo Router and identity/query/edit
hooks are not stubbed. Supabase remains fictional and in memory, with only an
owned event update allowed. External JavaScript network traffic is blocked;
analytics, push, maps and Places results use fixture boundaries. No new binary
was built and no real account or provider client was used.

On the existing iPhone 17 Pro Max / iOS 26.4 development binary, verified:

- Plans → creator detail → Manage Plan → save → detail → Back to Plans. Both the
  detail and feed showed the saved title; reopening the editor retained it.
- An unsaved title was discarded. Open Chat reached the actual chat screen;
  View Plan returned to detail, and reopening Manage Plan showed the saved title.
- Waitlist reached its actual empty queue screen; Back to plan restored detail.
- Post again was absent with the default communities flag off. In a separate
  fixture-only `EXPO_PUBLIC_COMMUNITIES_ENABLED=true` run it opened the real
  composer with copied title/category/schedule/location/capacity. Cancel restored
  Plans without submitting. No repository or release feature flag changed.

The first run logged exactly one local event update. No chat messages, waitlist
invitations or new plans were sent. These checks establish navigation/prefill
behavior, not live service authorization or write behavior.

Full route scanning exposed an unused duplicate `app/plan/plan-photo-edit.ts` as
an invalid route. Deleted that file after confirming it was byte-identical to
`lib/planPhotoEdit.ts` and that all consumers/tests already use the canonical lib
copy. The subsequent full-tree native bundle (4,957 modules) no longer reports
the invalid photo-helper route. No functional helper code changed.

136 screen/photo tests passed, app-wide TypeScript passed and `git diff --check`
passed. Evidence, fixture source, source hashes, save receipt and screenshots:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/full-app`.
Start the default fixture with its `start.sh` on port 8847; use the explicit
communities environment variable above only to repeat the gated path check.

A read-only `supabase status` check could not find a local test backend because
Docker/Podman is unavailable. Common installed Docker/OrbStack/runtime paths were
also absent. Backend integration remains pending selection/setup of a disposable
local environment or an identified staging environment. Production was not used
as a substitute. Pinned-runtime CI and physical-device/VoiceOver limits remain.
No push, merge, build, OTA or production write occurred.

## Disposable backend integration verification

Liz selected a disposable local environment. Installed Colima/Lima/Docker and
created a dedicated `washedup-plan-test` VM (4 CPUs, 6 GiB RAM, no host mounts).
Supabase CLI 2.117.0 / PostgreSQL 17 ran in an unlinked local project. All backend
services used an internal-only network, with an unprivileged fixed-target bridge
exposing API/database access on loopback. No default Docker context changed.
This supersedes the local-runtime blocker described above.

Restored the preserved September 14 schema-only derivative transactionally,
without changing its SQL. SHA-256:
`316d3eeb42771b44fd63cc93d3392dcc0e222e0ced6089ae5b85113bc139988f`.
It contains 176 public tables and 258 policies. All application triggers and
plan RLS remained enabled. Seeded three fictional phone accounts, one future
plan and two memberships; creation used the authenticated creator and guest
joining used the existing `join_event_atomic` RPC. No customer data was copied.
Vault and stored objects were empty; the cron job table was absent. The preserved
derivative disables four outbound callbacks, and service networking blocks
external access.

Ten checks passed over real Auth/PostgREST/Postgres using this checkout's
unchanged detail loader, draft hook, preparation helper and edit hook:

- Creator detail normalization; member reveal RPC; nonmember public fallback;
  anonymous attendee denial and no public handle enrichment.
- Authenticated save with confirmed receipt, preserving precise timestamps,
  nonpreset age bounds and capacity when those controls were untouched.
- Noncreator update affects no rows under real RLS.
- Database rejection of an overlong creator message stays retryable without
  changing the saved row.
- Place name and coordinates persist together.
- A response lost after a real committed PATCH enters uncertain-save recovery.
  Check changes confirms it by reading; it sends no second PATCH.
- Missing plans reject rather than fabricating detail.

The harness adapts the focus lifecycle for React test renderer and stubs unused
photo/logging boundaries. It does not replace database requests or policies.
These backend checks complement the native navigation evidence; they are not a
simulator connected to this backend. No app source fix was needed in this pass.

Evidence and repeatable start/test/stop scripts:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/local-backend`.
See its `README.md`, `client-results.json`, `restore-result.json`,
`environment-verification.json` and `schema-provenance.json`. Local credentials
remain in its private directory, outside this repository. The dedicated VM was
stopped after verification; fictional data is retained for another run.

This verifies the preserved September 14 schema contract, not current production
parity or a complete migration replay. Photo storage, remote Places responses,
SMS/push delivery and native-to-local-backend transport remain outside this pass.
Node 25.8.1 was used; pinned Node 20.20.1 CI and physical-device/VoiceOver limits
remain. No push, merge, app build, OTA or production write occurred.

## Pinned Node/npm verification

Exported committed source `14b4ea9` to an isolated audit checkout and installed
fresh dependencies with `npm ci --no-audit --no-fund`, using the repository's
exact Node 20.20.1 / npm 10.8.2 versions. Both package manifests stayed identical
to committed source. The original checkout's shared dependency installation and
simulator processes were untouched.

All 249 tests across the nine scoped suites passed, with each suite in a separate
process. This includes the five actual Places-widget regressions added after the
244-test combined checkpoint. App-wide TypeScript passed. The same isolated
checkout and fresh dependencies also passed all ten real local backend checks
under Node 20.20.1. No app source or dependency upgrade was needed.

Restarting the local VM exposed a test-helper readiness race: services resumed
before PostgreSQL was healthy. The audit startup helper now waits up to 45
seconds for an existing database to become healthy before invoking Supabase.
The backend harness accepts explicit checkout/output paths so the pinned run
uses the freshly installed dependency tree and preserves the previous evidence.
A complete stop/start cycle passed with the corrected helper.

The first PATH-based install selected npm 11.11.0; it was superseded by an
explicit npm 10.8.2 CLI invocation before repeating the final checks. npm reports
an existing engine mismatch: locked `@giphy/react-native-sdk@5.0.2` declares
Node >=22.14.0 while this repository pins 20.20.1. Installation and scoped checks
succeeded; this does not establish full Giphy/native compatibility. No version
was changed to suppress that warning.

Evidence, exact source/lockfile hashes, install log, per-suite JSON and backend
results:
`/Users/liz/Desktop/Ops/Audits/2026-10-24-plan-refactor-simulator/pinned-runtime`.
The neighboring `local-backend` directory retains the corrected startup helper.
The disposable VM is stopped after verification; fictional data is preserved.

This closes the scoped Node-version/dependency-install verification gap. It is
local macOS verification, not hosted Ubuntu CI or the entire `npm run qa:all`
release gate. The September 14 schema, external-provider, native-to-backend and
physical-device/VoiceOver limits above remain. No push, merge, app build, OTA or
production write occurred.
