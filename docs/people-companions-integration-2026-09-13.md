# People companion integration — isolated native package

September 13, 2026. This package continues the People row port into incoming requests, the minimal profile preview, shared sheet dismissal, and shared DM opening. It is local implementation work in the isolated checkout, not a release. The integrated checks below include the final scoped connection mutations, profile wiring, and request-control accessibility labels.

## Connected behavior

The existing development-only Afterglow flag supplies the same optional appearance to the Yours header/tabs, populated People body, search rows, person menu, request banner/stack, and minimal profile preview. Photos remain full color, missing/failed photos use the correct initial, long names can wrap, and controls have explicit pending/retry feedback. Legacy visual families remain when appearance is omitted. Reliability repairs also apply without appearance; this package is not purely CSS behind a flag.

A People row still opens the existing relationship page. Its separate options affordance retains Message, Make a plan, Start a Circle, and View profile. Request banners remain available when the person has no accepted connections and on other Yours tabs; request notification links keep their highlighted requester. Search still matches accepted people locally and resolves new people only by exact handle. The incoming search-row control says View because the destination is a minimal profile, not the request decision surface.

Request decisions stay explicit. Opening the list does not accept, decline, or block anyone. A request remains visible while its action is saving, with retry if it fails. Decline keeps its per-person confirmation; optional blocking is offered only after confirmed soft decline. The staged blocking choice stays available until acted on or dismissed, while the legacy presentation keeps its existing timer. Old actions, prompts, timers, or completions cannot act on a replaced request or a new visible visit.

The minimal profile shows only its existing face/name/shared-history information. Failed or unavailable profiles receive an honest state instead of an endless spinner. Add is restricted to the existing minimal profile kind and confirmed target/account, locks repeated taps, waits for a recognized normalized request/connection outcome, and leaves the profile open with retry on failure. Private full-profile fields are not introduced here.

RequestStack and the minimal profile supply an optional per-call ownership scope to the existing connection mutation hook. It is captured before React Query can schedule or pause the mutation; the hook checks the current visit/account before the actual write, after the response, and before each cache invalidation. Request decisions also recheck whether the original request can still be acted on at dispatch. Tests cover a changed account, account A→B→A, dismissed/reopened visits, offline resume, and overlapping operations with distinct scopes. Legacy callers that omit the new scope retain their existing API and behavior; these guards are not claimed for every connection-mutating surface in the app.

The shared BottomSheet keeps its timing default and optional Circle-composer spring mode. Visible visits own their animation completion; old dismissals cannot close reopened sheets. Rotation uses current dimensions, Reduce Motion is respected, grabber dragging remains separate from child scrolling, and the Afterglow presentation adds a visible Close control. Existing CirclePlanComposer tests are included specifically because this shared primitive is also used there.

Shared DM opening preserves the no-argument hook and scalar recipient/result API, existing RPC, server eligibility checks, and concurrent legitimate recipients. Account ownership is captured before React Query scheduling, checked before dispatch and after the receipt, and retired synchronously on account changes/unmount. Empty or non-string DM receipts do not dirty the inbox or route a caller. The People parent additionally protects its current person, focus, tab, and menu selection and suppresses the hook's obsolete-operation rejection.

## Preservation boundaries

No database migration, record deletion, account/session mutation, recipient broadcast, provider setting, payment change, release command, or live RPC was performed by these checks. Existing community/Circle IDs, memberships, histories, private answers, plan capacities, and join/introduction gates were not changed. Bottom navigation remains Plans, Scene, the central creation action, Chats, Yours. Existing server RPC names and acceptance/blocking semantics remain authoritative.

The existing People collection/order and mounted search input remain. These rows still render the complete collection; this package does not claim virtualization or measured native scroll performance. Add-people discovery/paths, the full relationship and individual-profile pages, and remaining whole-app designs are separate work, not declared complete by these companion changes.

## Integrated validation

The final package run passed **225 tests across 10 suites**, plus a clean full-project TypeScript run. Exact test files and counts, relative to the isolated checkout:

| Suite | Passed |
| --- | ---: |
| `components/yours/requests/__tests__/RequestStack.lifetime.test.tsx` | 31 |
| `components/yours/profile/__tests__/ProfileCardSheet.test.tsx` | 26 |
| `components/yours/primitives/__tests__/BottomSheet.test.tsx` | 14 |
| `components/circles/plan/__tests__/CirclePlanComposerLifetime.test.tsx` | 17 |
| `hooks/__tests__/useGetOrCreateDm.lifetime.test.tsx` | 35 |
| `hooks/__tests__/usePeopleConnectionMutations.scope.test.tsx` | 21 |
| `components/yours/__tests__/YoursScreen.people.test.tsx` | 33 |
| `components/yours/people/__tests__/PeoplePresentation.test.tsx` | 20 |
| `components/yours/search/__tests__/PeopleSearchResults.test.tsx` | 19 |
| `components/yours/paths/__tests__/PersonRow.test.tsx` | 9 |
| Total | 225 |

Execution: the ten files above were supplied together to `node node_modules/jest/bin/jest.js` with `--runInBand --silent --json`. Jest reported 10 passing suites, 225 passing tests, and no snapshots. `node node_modules/typescript/bin/tsc --noEmit --pretty false` exited successfully with no diagnostics. The machine-readable run output is `/private/tmp/washedup-people-companions-tests-2026-09-13.json` (temporary evidence, not a release artifact).

All service calls in these tests are mocked. Component tests establish state/callback behavior and preservation, not production delivery or iPhone visual/performance quality. Root separately reported a browser visual pass on the actual React Native component fixture: 375px request failure/retry, 320px decline→Block failure/retry, 375px profile, and 320×500px long content/error/recovery. Root also reported a final Metro and fixture TypeScript pass. Native iOS keyboard, VoiceOver, Dynamic Type, gesture handling, image delivery, and device scrolling still require a build/device pass, followed by isolated-backend integration.

At this package's original verification, `lib/yours/connectionRequests.ts` still mapped an unrecognized raw `add_or_accept_person` RPC outcome to `requested`. That limitation is now superseded by the subsequent [strict receipt repair and 362-check integrated package](people-connection-receipts-2026-09-13.md): the shared helper preserves the three documented scalar outcomes and rejects unconfirmed data. The original 225-test run above remains the scoped historical record for this companion package.

## Package files

- Parent/appearance: `components/yours/YoursScreen.tsx`, `components/yours/header/YoursHeader.tsx`, `components/yours/header/YoursTabs.tsx`, `components/menu/MenuCard.tsx`.
- Existing People row package: `components/yours/people/PeopleScreen.tsx`, `components/yours/people/PeopleListRow.tsx`, `components/yours/search/PeopleSearchResults.tsx`, `components/yours/paths/PersonRow.tsx`.
- Requests: `components/yours/requests/RequestBanner.tsx`, `components/yours/requests/RequestStack.tsx`, `components/yours/requests/RequestRow.tsx`, `components/yours/requests/BlockPrompt.tsx`.
- Minimal preview/shared sheet: `components/yours/profile/ProfileCardSheet.tsx`, `components/yours/primitives/BottomSheet.tsx`.
- Shared mutation hooks: `hooks/useGetOrCreateDm.ts`, `hooks/usePeopleConnectionMutations.ts`.
- The ten test files listed above; `CirclePlanComposerLifetime` is a preservation regression suite, not a newly redesigned composer.

Related records: [People rows integration](people-rows-integration-2026-09-13.md), [People row component contract](people-native-rows-2026-09-13.md), and [DM account ownership](dm-opening-account-ownership-2026-09-13.md). The completed shared DM repair supersedes the earlier People-row note's remaining-DM-audit item. Already dispatched server work cannot be undone by client lifetime guards; release verification must still exercise the real server authorization and current account transitions.
