# Confirmed People outcomes and integrated package verification

September 13, 2026. Local isolated implementation only. No SQL, live RPC, provider, production record or release change.

## Confirmed source contract

[The saved SQL function](/Users/liz/Desktop/WashedUp/Implementation/chat-context-slice/supabase/migrations/20260611000000_add_or_accept_person.sql:34) declares `RETURNS text` at line 39 and has exactly three successful scalar receipts:

- `requested`: the existing send path completed (line 94).
- `now_connected`: the existing incoming-request acceptance path completed (line 89).
- `already_connected`: the pair was already connected (line 76).

Server failures remain errors. There is no documented successful null, object, array or unknown-string receipt. This is a saved source contract, not a statement that this migration has been checked against production in this task.

The old `parseAddOrAcceptOutcome` mapped all unrecognized data to `requested`. This falsely confirmed that a request existed, even when the response established nothing. It could close a minimal profile or mark a person Requested with no reliable receipt.

## Bounded repair

`lib/yours/connectionRequests.ts` now passes the three existing receipts through unchanged and throws `UnconfirmedPeopleConnectionError` for anything else. `friendlyConnectionError` preserves its specific message: “We couldn’t confirm your request. Try again.” The shared hook therefore does not invoke success callbacks or invalidate success caches on an unconfirmed result. The original person/query and explicit retry remain available in the actual handle/backlog views.

RPC name, arguments, contexts, scalar result type, reciprocal-request handshake, server authorization/block/eligibility rules and caller APIs are unchanged. Current server errors retain their original identity. No automatic retry was added. An explicit retry uses the same person/context and the existing server handshake to obtain its reconciled outcome; an unconfirmed response does not mean a server write was rolled back.

All clients of `sendOrAcceptPeopleRequest` receive this stricter helper behavior, including legacy callers without an optional operation scope. The survey's direct RPC path does not call this helper and is outside this patch. This record does not claim global strict receipt validation across every app mutation.

## Integrated checks after all source owners finished

**362 tests passed across 15 targeted suites. Full-project TypeScript passed with no diagnostics.** The final run includes Root's PathsSheet/QR and person-route changes, the final Handle/Backlog views, KeepPage/KeepHero/StoryTimeline, the shared invitation and connection helpers, and existing request/profile/parent dispatch coverage.

| Suite | Passed |
| --- | ---: |
| `components/yours/paths/__tests__/PathsAndQR.lifetime.test.tsx` | 29 |
| `components/yours/paths/__tests__/PeoplePaths.lifetime.test.tsx` | 30 |
| `components/yours/keep/__tests__/KeepPage.test.tsx` | 35 |
| `components/yours/keep/__tests__/KeepPresentation.test.tsx` | 14 |
| `components/yours/keep/__tests__/KeepHero.date.test.tsx` | 3 |
| `lib/yours/__tests__/connectionRequests.test.ts` | 25 |
| `hooks/__tests__/usePeopleConnectionMutations.scope.test.tsx` | 32 |
| `hooks/__tests__/useReferral.lifetime.test.tsx` | 20 |
| `lib/__tests__/invite.lifetime.test.ts` | 14 |
| `lib/__tests__/referralLink.test.ts` | 37 |
| `components/yours/search/__tests__/PeopleSearchResults.test.tsx` | 19 |
| `components/yours/profile/__tests__/ProfileCardSheet.test.tsx` | 26 |
| `components/yours/__tests__/YoursScreen.people.test.tsx` | 33 |
| `components/yours/requests/__tests__/RequestStack.lifetime.test.tsx` | 31 |
| `components/yours/primitives/__tests__/BottomSheet.test.tsx` | 14 |

The listed files were run together through Jest with `--runInBand --silent --json`. Permanent local report: `/Users/liz/Desktop/WashedUp/Design/Shared Experience - Round 1/verification/people-connections/test-results.json`. TypeScript command: `node node_modules/typescript/bin/tsc --noEmit --pretty false`.

The final run also includes the five QR readiness/identity timing regressions: a validated code remains usable while optional profile metadata is pending or rejected, and stale account/visit metadata cannot enrich the current QR. Staged Keep upcoming cards now show the existing Los Angeles date/time convention beneath a wrapping title; date-only source values retain the correct day without inventing a time, invalid dates are omitted, and the plan route is unchanged. Staged Keep and timeline month names use natural capitalization; legacy presentation remains unchanged. Timeline thumbnail identity/failure coverage is included. These are component and source checks; root owns the browser visual review.

New receipt checks cover malformed scalar/object/array/null data, preserved known receipts and RPC errors, exact retry arguments, no success/cache invalidation from unconfirmed raw data, and the actual helper→hook→handle/backlog path retaining the person with truthful error/retry. No server behavior or native delivery is simulated as verified production behavior.

The previously reported PeoplePaths test callback typing errors are corrected. The earlier unknown→requested limitation in the People companion/path records is superseded by this repair. Referral receive auth/consumption recovery remains separate, as documented in [People invite boundaries](people-invite-boundaries-2026-09-13.md). Browser visuals are coordinated by Root; physical-device, real isolated-backend and release/preservation checks remain separate.
