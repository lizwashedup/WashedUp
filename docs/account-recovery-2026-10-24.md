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
