# Account recovery and signup safeguards — October 24, 2026

## Behavior

An accepted phone code remains accepted when the following account/profile lookup fails or times out. The screen keeps the user in recovery, offers a bounded retry, and preserves the existing notification/invitation/checkout handoff and account/ban/phone gates. A missing or malformed profile is not treated as proof of a new account. The real database initial status is `pending`; it routes to Basics alongside a successfully read null status.

Completed members leave Basics for Plans without a profile write. Before saving, Basics reads completion; the actual update also excludes completed rows, so a second device cannot finish signup and then be reset by this stale form. Navigation, draft clearing and optional audience reconciliation require an exact save receipt. Uncertain saves retain the form. A later account change or unmount retires pending reads, writes that have not started, save feedback and navigation. Already-dispatched database writes cannot be cancelled by the client.

The Basics status read and conditional update are extracted into `lib/onboardingBasics.ts`; the screen retains form/lifecycle behavior. Identity lookup errors remain unresolved rather than triggering automatic signout.

## Proven defects caught during integration

The preserved October 19 local patch passed its original 98 focused tests. Four new lifecycle tests failed against it: pending completion checks could still dispatch a write after unmount/account change, and late receipts could still clear drafts, invoke optional reconciliation or navigate. All four pass with visit/account retirement.

Real database verification rejected the test fixture's invented `basics` enum. Inspection of the unchanged schema showed `pending` is the initial status. A new real-root verification-handoff test then failed against the patch's allowlist: a legitimate pending account remained on verification. The corrected allowlist and database-realistic fixtures pass. No database enum or policy was changed.

## Verification

- Node 20.20.1, isolated source checkout, previously clean npm 10.8.2 lockfile install: **163 tests in 10 suites passed**. Includes root notification handoff, onboarding/draft cold starts, phone entry and push-primer lifecycle.
- Full application TypeScript check and static auth invariants passed; diff whitespace checked.
- **Nine real local Auth/PostgREST/PostgreSQL checks passed**, loading the unchanged TypeScript helpers with a local client: status read, null/pending saves, exact receipt, completed-row refusal, completion between read/write, other-account and anonymous write refusal, missing-profile error, and a lost HTTP receipt after a committed save. The fictional profile was restored afterwards and the dedicated VM stopped.
- Native iPhone 17 Pro Max / iOS 26.4: actual VerifyCodeScreen/OtpInput, existing development binary, fictional in-memory service and external network blocked. Returned-error and hanging-read recovery both proposed Plans after manual retry, with one code verification and two profile reads. Error copy and accessible retry control were visible; keyboard dismissed after code acceptance. This is component/native evidence, not real SMS or simulator-to-backend E2E. Complete root notification routing is covered separately by automated integration tests.
- Jest reported the previously recorded delayed-exit warning from onboarding timeout timers; runs exited normally. No tests were skipped in the final 163-test run.

Evidence and repeatable harnesses: `/Users/liz/Desktop/Ops/Audits/2026-10-24-account-recovery`. `verification.json` binds the tested source hashes; `lifecycle-before.*` and `pending-before.*` preserve failing regressions. The local database remains the reviewed September 14 schema snapshot, not a claim of current production parity.

## Scope and delivery

Source: `codex/plan-detail-refactor`, based on `e5a8abe`, including the earlier plan refactor and merged Scene cards. The six original account-recovery files were copied from `/Users/liz/Desktop/WashedUp_HQ/washedup-foundation-recovery-20261019` only after verifying their base files were unchanged. Original patch bytes are preserved in the audit folder and the source worktree remains untouched. Push-monitor/configuration/review-only SQL changes from that worktree are separate and are not included in this account-recovery commit.

This is a verified local candidate. No remote push, production data/configuration change, SMS/email, native build or app publication occurred. Live provider behavior and current production schema parity remain release checks.

## Isolated release preparation, October 25

The account changes are now isolated from PR21 on
`codex/account-recovery-isolated-20261026`, based on published main `1eee9bf`.
This branch includes no plan refactor, push-monitor configuration or SQL.
The earlier native/database evidence above remains historical; final isolated
source and live provider behavior must be checked before release.

The refreshed review found a further same-account session race: a delayed
missing-session sign-out remained active after SIGNED_IN or TOKEN_REFRESHED.
Two new regressions failed against the PR21 candidate. An auth revision now
invalidates old missing-user responses and delayed sign-out when newer auth
state arrives, preserving the draft and clearing outdated expiry feedback.
Coverage also retains genuine missing-session exit without a newer session.
The isolated four-suite check passes 86 tests and TypeScript passes.
Evidence: `/Users/liz/Desktop/Ops/Audits/2026-10-25-salsa-freeze/account-renewal-red.log`
and `account-recovery-isolated-green.log` in the same directory. This patch has
not been published. PR31/34 ticket fixes remain a separate release batch.
