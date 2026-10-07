# People invite validation and lifetime checks

September 13, 2026. Bounded local parser repair and tests for the Add People package. No production reads/writes, live invite claims, native messages, migrations or release actions were performed.

## Established invite behavior

`buildReferralLink` produces `https://washedup.app/r/<code>`. The same link is encoded by the QR and shared through the existing native SMS/share helper. Opening a composer does not establish that a message was sent or delivered.

The saved `claim_referral_invite` migration creates an inviter-to-recipient **pending** people request after authentication. It does not immediately accept the relationship. Existing connected, block, self and terminal-decline restrictions remain. The native route opens the inviter's existing person page. The saved web route only offers native/store destinations and tells a new user to reopen the invite after installation. There is no true deferred installation attribution in this implementation.

Accordingly, truthful outgoing copy is “Send an invite they can accept in the app” and “Scan to open your invite in WashedUp.” An automatic appearance in accepted People after signup is not promised. QRShareView's historical comment claiming no native receive infrastructure predates the current route and migration.

## Parser repair

Only `parseReferralCode` changed in `lib/yours/referralLink.ts`; the claim, storage and runtime receive workflow are unchanged by this repair.

Accepted forms:

- `https://washedup.app/r/<code>` and the `http`/`www` web variants already explicitly supported by `lib/url.ts`.
- The configured `washedupapp://r/<code>` native scheme.
- An optional trailing slash, query or fragment; the extracted code preserves its case.
- The server/web code alphabet `[A-Za-z0-9_-]`, length 1–64. Generated codes currently use seven characters, but the existing valid-code contract is broader.

The complete scheme/authority/path is checked. Lookalike hosts, embedded own-domain paths/queries, userinfo, ports, subdomains beyond the existing `www` form, extra path segments, encoded path delimiters, whitespace, empty codes and overlong codes cannot reach a session read, claim RPC or pending-referral write through `handleReferralUrl`. The route path remains lowercase `/r/`.

## Optional lifecycle coverage

Root's updated `useReferral` validates returned codes and optionally accepts a caller-owned `isCurrent` scope. Scoped calls check the authenticated account before code generation and discard late responses. Callers own their account epoch and visible visit; the hook does not independently subscribe to account changes. Legacy unscoped callers keep the existing API and no extra auth preflight, while malformed code receipts are rejected for both forms.

Root's updated `openInviteComposer(code, isCurrent)` checks before starting, after the native capability wait, and before a fallback share. Existing platform-specific SMS intent syntax and fallback behavior are retained. Cancellation does not trigger another share. Once an OS composer has already opened, this client guard cannot recall it; the UI must not claim send confirmation from its return value.

The shared connection-mutation tests now also exercise Root's scoped `setVisibility` wrapper: exact existing global/person arguments, explicit false values, legacy callback shape, queued account/visit retirement, A→B→A, late receipt suppression and current failure/retry. These are lifetime protections, not changes to visibility policy or server authorization.

## Verification

One combined Jest run passed **101 tests across four suites**:

| Test file | Passed |
| --- | ---: |
| `lib/__tests__/referralLink.test.ts` | 37 |
| `lib/__tests__/invite.lifetime.test.ts` | 14 |
| `hooks/__tests__/useReferral.lifetime.test.tsx` | 20 |
| `hooks/__tests__/usePeopleConnectionMutations.scope.test.tsx` | 30 |

Executed with the actual hook/helper implementations, React Test Renderer and React Query where applicable, using mocked authentication/RPC/native linking. The connection suite includes the earlier 21 connection-mutation checks plus nine visibility checks. The referral suite retains the two earlier claim-direction checks. All scoped diffs pass `git diff --check`. Machine-readable evidence: `/private/tmp/washedup-invite-boundaries-tests-2026-09-13.json`.

At this initial run, full-project TypeScript reported two concurrent test-file callback errors in `components/yours/paths/__tests__/PeoplePaths.lifetime.test.tsx`. The owner corrected them. The subsequent [integrated package run](people-connection-receipts-2026-09-13.md) passed 362 tests across 15 targeted suites and full-project TypeScript with all source owners finished. That final run supersedes the intermediate typing result; the 101-test table above remains the original bounded invite verification.

## Separate work required before referral release verification

1. Bind the receive route, background claim and pending-referral consumption to the initiating authenticated account and route lifetime, including A→B→A and late navigation. Outgoing scope checks do not repair those existing receive paths.
2. Retain a pending referral through retryable claim failures. The current best-effort consumer removes the stored code before confirming success and swallows errors. Concurrent consumption and a replacement pending link need explicit ownership.
3. Distinguish invalid/unavailable invites from temporary network/auth failures. The existing native landing turns either into “this invite is gone.” Validate the raw inviter ID before navigation.
4. Exercise installed/signed-in, installed/signed-out, cancelled sign-in, failed/retried claim, accepted/blocked/declined relationships and post-install reopening against the real isolated server and native links. The saved migration and mocked tests do not establish its current deployment or delivery.

Already-dispatched server work cannot be retracted by client lifetime guards. None of these remaining receive-path changes were folded into this parser patch.
