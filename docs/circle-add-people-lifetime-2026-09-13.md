# Circle Add People request ownership — September 13, 2026

This isolated client package changes only `components/circles/AddPeopleSheet.tsx`, `hooks/useInviteToCircle.ts`, their two new focused test files and this document. No real invitations, membership changes, network calls, dependency installs or migrations were performed.

## Existing consent and membership contract

The newest saved `invite_to_circle` definition is `supabase/migrations/20260816123000_circle_member_vouching.sql:160`. A current circle member may directly add their accepted, unblocked Your People connections; this is existing joined membership, not a new request/accept flow. Already joined targets are no-ops. The server still restricts restoration of a removed member to admins and preserves its existing role rules. The previous hook's “admin-gated” comment described an older migration and was corrected; no authorization behavior was changed locally.

The sheet still reads `get_yours_grid(p_user_id)`, checks the same Yours row shape, removes existing members from the selectable list, uses the existing picker search and selected-person visibility, and sends only selected recipient IDs to `invite_to_circle(p_circle_id,p_user_ids)`. It also excludes the initiating account itself, consistent with the server's existing self exclusion. No role, consent or member insert logic moved into the client.

## Reproductions and repairs

Before implementation, actual-hook tests reproduced **8 failures with 1 compatibility case passing**: missing initiating identity, replacement-account adoption, delayed auth without scope checks, a retained A → B → A circle callback, old result feedback/invalidation, account A → B → A, duplicate rapid mutations, and unknown null results acknowledged as zero.

Actual-sheet tests independently reproduced **7 failures with 1 compatibility case passing**: hidden-sheet reads, selection surviving close/reopen, selection surviving circle changes, a retained submit including a newly joined member, rapid submission/dismissal, stale failure feedback after reopening, and a query error appearing as an empty people list.

`AddPeopleSheet` now accepts optional `scope?: InviteToCircleScope | null`, where the scope is `{ userId: string; isCurrent: () => boolean }`. The parent should keep that scope object stable through metadata refreshes and retire it for a different route/account/admission visit. Root owns the Circle chat caller integration. A missing optional scope remains supported; the sheet independently uses the existing read-only `useObservedUser` hook. Explicit null holds account-dependent reads and actions.

The sheet mounts its request subtree only while visible. Circle, account epoch and supplied scope changes produce a new visit, resetting selections, search, pressed state and pending callbacks. Each visit has an account/circle/epoch/visit-suffixed query key under the existing `yoursKeys.grid(userId)` prefix, a consumed abort signal and pre/post read ownership checks. This keeps ordinary prefix invalidation while preventing old cached or pending data from a prior visit, including A → B → A, from becoming the current people list. The local query is discarded after its observer leaves; global `useYoursGrid`, `useAuthUserId` and `useObservedUser` are unchanged. Query errors and non-array results have a retry state rather than claiming no relationships. Identity failures remain retryable. The checkbox state has explicit native and web checked/disabled semantics.

The sheet keeps a synchronous pending ref, disables selection during its current add request, and filters retained submit callbacks against the latest committed eligible selections. Dismissal remains possible while the network is pending: it retires this UI visit instead of trapping the user. A retired callback cannot submit, close or display its error over a replacement sheet. Current failures retain the selection for explicit retry. Successful `onAdded` and `onClose` feedback still runs only after a confirmed current RPC result, with the existing callback order.

`useInviteToCircle(circleId,userId,scope?)` retains `mutate(string[], options?)` and `mutateAsync(string[], options?)`. It captures the owner and a copied recipient array before React Query schedules the mutation, locks duplicate calls synchronously, observes account transitions without asynchronous auth calls inside the listener, checks `getUser` against the initiating ID, and checks ownership before dispatch and after completion. Retired asynchronous calls reject with exported `ObsoleteCircleInviteError`; `isObsoleteCircleInvite(error)` identifies it. Retired void calls are ignored, and duplicate void calls are ignored; a duplicate `mutateAsync` rejects while the first remains pending.

Only a nonnegative integer RPC result is confirmed; zero remains valid. Missing or malformed counts no longer silently become zero. Current successful calls preserve `circleKeys.detail(circleId)` and `circleKeys.mine(userId)` prefix invalidations. Retired completion does not invoke supplied callbacks, invalidate a replacement account or expose its old result through the returned status fields. The exact-attempt finalizer cannot unlock a newer request. Automatic mutation retry is disabled.

## Validation

**33 tests in 2 suites pass:** 18 actual-sheet tests and 15 actual-hook tests. Coverage includes the baseline reproductions plus current failure/retry, recipient snapshot, unmount during auth/RPC, late initial identity, scoped denial, missing identity, old grid reads after close/reopen and account A → B → A, same-account token refresh, unknown grid result, and an old finalizer versus a newer pending request. Supabase is mocked and the repository test setup blocks network egress.

```sh
./node_modules/.bin/jest --runInBand --ci --cacheDirectory=/private/tmp/washedup-circle-add-agent-jest components/circles/__tests__/AddPeopleSheet.lifetime.test.tsx hooks/__tests__/useInviteToCircle.lifetime.test.tsx
./node_modules/.bin/tsc --noEmit --pretty false --incremental --tsBuildInfoFile /private/tmp/washedup-circle-add-agent.tsbuildinfo
git diff --check -- components/circles/AddPeopleSheet.tsx hooks/useInviteToCircle.ts components/circles/__tests__/AddPeopleSheet.lifetime.test.tsx hooks/__tests__/useInviteToCircle.lifetime.test.tsx docs/circle-add-people-lifetime-2026-09-13.md
```

Both the test command and full TypeScript check passed. Root retains ownership of the pre-existing dependency symlink and any final combined suite/device verification.

## Limits

Integration follow-up: root added dismissal-during-network-wait and pre-dispatch-close coverage. The current sheet suite has 19 cases; with the 15 hook cases, **34/34 pass**. The original duplicate-submit check is retained. Closing never claims to cancel a server-side add already dispatched, and a late success cannot affect a reopened sheet.

Client retirement cannot retract a previously dispatched RPC, bind a server transaction atomically to a UI epoch, or prove notification delivery. A lost response can still follow a committed direct add; the server's already-joined no-op behavior is preserved, but no new receipt or idempotency facility is claimed. Current errors retain the existing retry copy. Accepted relationship, block state, current membership, role and removed-member checks at execution remain the server's responsibility. Broader Circle detail query ownership and parent lifetime changes are separate root-owned packages. This package has no device or production verification claim.
