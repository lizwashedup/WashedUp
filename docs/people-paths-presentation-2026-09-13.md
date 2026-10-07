# People paths: handle lookup and plan history

Isolated native implementation. No production deployment, RPC, migration, discovery rules, or notification behavior changed.

## Component contract

`HandleLookupView` and `PlanHistoryBacklog` retain `userId` and `onPressPerson`. Each accepts optional `appearance: { fonts: AfterglowFontFamilies }` and `operationScope: PeopleConnectionScope`. Without appearance, the existing palette and type remain. With appearance, the views use the shared People row, cream background, clay actions, restrained borders and at least 44-point retry controls.

The parent should memoize one operation scope per visible path entry. Its `isCurrent` can retire work synchronously on closing or navigation. Account changes, auth changes, query changes, and unmount independently retire local operations. `usePeoplePathVisit` shares this lifetime handling and feedback without changing data-fetching hooks.

## Preserved behavior and repairs

- Handle lookup keeps the existing minimum length, normalization, 300 ms debounce, exact handle RPC, and explicit Add handshake. Previous query matches do not appear or remain actionable during a different lookup. Incoming requests require the existing explicit Add action.
- Plan history keeps the existing completed-plan backlog RPC and local first-name substring filter. It does not become a directory or fuzzy remote search.
- The TextInput stays mounted while loading, results, errors, or empty states change. Plan history retains FlatList scrolling and handled keyboard taps.
- Read failures and retries are distinct from no match or a genuinely empty backlog. Entered text survives failures.
- Add shows a pending state while the request is in flight; confirmed requested and mutual connection outcomes are distinct. Immediate repeated presses share one lock. Failures retain context and offer a labeled retry.
- Per-call mutation scopes recheck account, query/entry, and the current target's eligibility immediately before dispatch. An operation begun in an old query/account/visit cannot report success or failure in a new one. Already-dispatched server operations may finish, while stale UI/cache callbacks are suppressed by the mutation hook.

## Validation

`components/yours/paths/__tests__/PeoplePaths.lifetime.test.tsx`: 30 actual-component checks passed. Covers normalization/debounce, exact match, input identity, pending/confirmed outcomes, mutual handshake, read/write retry, duplicate presses, auth and query A→B→A, parent retirement, unmount, changing eligibility, local-only filtering, exact profile targets, and raw unconfirmed Add receipts retaining the person and retry. Relevant diff whitespace check passed. The final integrated package passed 362 checks across 15 suites plus full-project TypeScript; see [integrated receipt and package record](people-connection-receipts-2026-09-13.md). Companion visual verification is coordinated by the parent task.

Shared contract repair: the previous unknown→requested fallback is now removed. The helper only accepts the three scalar outcomes in the saved SQL contract; unknown/null data produces explicit unconfirmed feedback without marking the person Requested. Original handshake, eligibility, RPC and callback APIs are retained. The real server deployment has not been checked by these mocked component tests.
