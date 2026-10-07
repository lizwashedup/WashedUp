# Plan composer account lifetime — local repair, 2026-09-13

This package changes the isolated native `PlanComposerV2` posting and draft-save sequence. It is not a server transaction, production deployment, notification delivery verification, or a complete composer lifecycle repair.

## Demonstrated failure

The actual component regression suite initially passed its four existing cases and failed all six new account-lifetime cases. A post initiated by account A used the different account B returned by a delayed `getUser` as `creator_user_id`. An event insertion resolving after A→B or A→B→A still started creator membership. A retired membership success committed the old optimistic card; a retired failure opened recovery in the new account; an event insertion resolving after unmount still started membership.

All operations in these tests use mocked Supabase, invitation transport, storage, and navigation. No plan or invitation was sent to a backend.

## Implementation and preservation

- [`PlanComposerV2.tsx`](../components/post/PlanComposerV2.tsx) captures the known starting account and the existing `useObservedUser.isCurrent` epoch predicate in one synchronous post/draft operation. Unknown identity can be retried and cannot adopt the account returned by a later read. The authenticated read must match the captured creator before an event write starts.
- Every awaited event write, creator-membership write, existing retry delay, retry write, rollback write, and celebration-storage completion checks that exact operation and viewer still own the screen. Stale success, error, and finalization cannot reset another account's form, commit its predecessor's card, open recovery, or release a newer attempt's lock.
- Account changes clear old form/route-prefill, invitation, confirmation and sharing state before paint. The first identity resolution preserves the initial prefill. An A→B→A sequence still retires A's first attempt. Post/share completion callbacks and their existing delayed navigation also check the captured account lifetime.
- Retiring a pending operation removes only its temporary optimistic row from its original account's feed/my-plans caches and marks those keys stale without a refetch. It does not restore an old whole-list snapshot over newer data. Current-attempt failure retains the original rollback/recovery behavior. Confirmed cards are not removed because a later local-storage completion is retired.
- The audience profile query still reads `profiles.gender`; it now uses the observed account and rejects late results from the previous account. The existing audience choices and plan validation rules remain.
- Save-as-draft uses the same ownership/serialization checks because it shares the form and loading state. Its original insert/update, owner filter, draft status, and no-membership/no-invitation behavior remain.

The normal sequence remains event insert/update → creator membership (including the existing one retry and rollback behavior) → duplicate-plan notification/invitation request. RPC names, recipient policy, server columns, creator membership role, limits, fees, capacity, dates, privacy/audience fields, and route destinations are unchanged. Invitation retry continues using the already saved plan, and an RPC acknowledgement is still not a delivered-person count.

## Checks

Run in the isolated native directory using the existing preserved dependency symlink; no installation:

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-composer-account-agent-jest components/post/__tests__/PlanComposerV2.invites.test.tsx components/post/__tests__/usePostPlanInvitations.test.tsx components/post/__tests__/PostConfirmation.invites.test.tsx components/post/__tests__/PeoplePickerSheet.test.tsx
```

**44 tests passed in 4 suites**, including **20 actual composer cases**. Coverage includes the six original reproductions, sign-out/retained post callbacks, unknown and inconsistent identity, a newer attempt's lock, removal of only the retired optimistic card, membership retry retirement and normal retry order, confirmed-plan/local-storage separation, delayed navigation, draft saving, and audience profile results. Existing invitation retry and zero-recipient confirmation gates still pass.

```sh
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-composer-account-agent.tsbuildinfo
git diff --check -- components/post/PlanComposerV2.tsx
```

Both commands passed. The root agent owns the existing dependency symlink and its cleanup.

## Limits and follow-up boundaries

An event or membership write already dispatched can finish on the server after local retirement. The client cannot guarantee atomic account binding across Supabase's asynchronous request/token handling, cancel an accepted write, or certify rollback/delivery from a missing response. If an event write was dispatched before the account changed, this repair deliberately stops the subsequent membership/rollback/notification/invitation steps; an event could therefore need authoritative reconciliation. No compensating write is attempted using a replacement account. A returned account's later read remains the source of truth; this package does not add an orphan-recovery protocol or an idempotent create transaction.

An invitation or duplicate-plan notification already dispatched also cannot be retracted by these guards. The existing invitation hook suppresses stale local acknowledgement/retry authority; this is not server-side sender scoping or delivery enforcement.

The separate photo permission/picker/preparation/upload chain is unchanged and still needs its own account/attempt-lifetime audit. Generic retained field, place-picker and dismissal callbacks are outside this focused post/save package. No device/render claim is made, and no shared authentication hook, provider, migration, or database policy was edited.
