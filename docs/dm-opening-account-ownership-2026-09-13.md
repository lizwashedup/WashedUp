# DM opening: account ownership

The isolated native hook `hooks/useGetOrCreateDm.ts` still exposes `useGetOrCreateDm()` and `mutate(otherUserId)` / `mutateAsync(otherUserId)`. It returns the scalar Circle ID from the same `get_or_create_dm` RPC. No caller arguments, block checks, connection rules, Circle membership rules, or production records changed.

Each invocation captures its account owner before React Query can schedule the mutation. The hook subscribes before reading the initial cached session. A cold-start invocation waits until that initial identity is established; a valid initial event can finish this wait without waiting for a stalled cached read. A later initial read or INITIAL_SESSION cannot replace a newer observed identity. Same-account token refreshes retain valid work; an account transition, sign-out, recovery transition, or unmount retires old work synchronously. Returning from account A to B and back to A does not revive it.

The hook verifies the initiating account with `getUser` before dispatch and checks the cached session again after the RPC receipt. Success requires a nonempty string ID. Obsolete results do not dirty the inbox, invoke caller callbacks, or appear as the new account's mutation state. Automatic mutation retries are disabled; an explicit retry remains available. Different legitimate recipients can still be opened concurrently, preserving the existing public API and React Query observer semantics.

The People parent separately owns person selection, menu dismissal, focus, and late-navigation guards. This shared hook cannot infer another caller's navigation intent or a changed profile target; those remain caller responsibilities. It cannot cancel or undo an RPC the server already accepted. Client account checks complement the server's existing authorization; they do not replace it.

Validation: real-hook tests use mocked Supabase identity/events/RPCs and a QueryClient with retry-enabled defaults. Coverage includes no-argument API, legacy mutate callbacks, unknown receipts, explicit retry, early initialization, stalled/read-event races, A→B→A, scheduler/preflight/receipt gaps, suppressed stale feedback, unmount, same-account refresh, and concurrent recipients. No live RPCs or account changes were performed.

## Optional caller visit scope: individual-profile follow-up

The hook now also accepts `options.scope?: {userId, isCurrent}` on `mutate` and `mutateAsync`. The individual-profile page supplies it to retire a request on target/account/focus/visit change while the hook stays mounted. The hook copies the scope before scheduling; it verifies that scope and account at every await boundary and before dispatch, inbox dirtying, callbacks and async return. A delayed preflight cannot dispatch after that page is left. Unscoped existing callers retain their original API and account/mount behavior. This adds no global lock or new product rule.

The added real-hook cases cover current scoped success, mismatched account, retired caller, scheduled/cold-start/preflight/RPC/final-session retirement, captured options identity, quiet late failures, independent current scopes and retirement from a success callback. A dispatched RPC can still finish on the server; this change prevents later client effects and prevents dispatch only when retirement happened beforehand.
