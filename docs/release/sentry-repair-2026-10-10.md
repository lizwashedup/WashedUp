# October 10 Sentry repair and release preparation

The empty-query, all-environments 24-hour Sentry inventory contained seven
issue groups / 22 events. The reviewed events identify the currently published
October 8 iOS update `01a11e1d-09a0-73e8-9c16-1bca74895a0d`, Build 51.
PR #17 and PR #18 were not live when these events occurred. The seven-day
inventory adds the previously documented native/older-client issues; no new
native hang or fatal event appears in the reviewed 24-hour list.

## Verified corrections

- **53, plan departure:** Production membership PATCH succeeded, then the
  optional chat INSERT failed with 42501. A read-only policy check confirms
  posting requires joined membership. Stop the invalid post-leave insert;
  preserve the confirmed departure, attendee/feed refresh, and cancellation
  announcement. Do not announce before departure succeeds or broaden RLS.
  A future automatic departure notice needs a server-owned atomic operation.
- **50, presence cleanup:** PostgREST wraps its transport timeout in a plain
  `AbortError: Aborted` error object. Include that exact shape in PR #18's
  bounded presence recovery. Retain original-account verification, conditional
  cleanup, same-room ownership, finite retries and genuine rejection handling.
- **4Z and read suspension:** Realtime sender/reaction hydration and older-page
  reads now retire across suspension, including background/foreground ABA.
  They do not start reads while inactive. A foreground realtime read failure
  retains loaded messages and exposes the existing history retry control.
  Resume uses the existing foreground history refresh. Drafts and in-flight
  sends keep their original lifetime and uncertain-receipt recovery.

## Reports requiring careful interpretation

All fourteen 4W events were inspected: eight occurred in the background and
six in the foreground. Contexts include identity checks, history/hydration,
and one send. The background repair does not solve every foreground timeout.
51 follows unsuccessful account verification; 52 is a transient presence auth
abort. The earlier PR #18 repairs improve recovery but cannot guarantee network
availability. 4Y is a timed-out reaction preflight; its explicit retry and
no-automatic-toggle protections remain. No Sentry issue or alert was silenced.

Read-only signup totals at18:51PDT: nine new accounts, all nine phone verified,
seven onboarding complete, zero missing profiles today or over the last seven
days. The two incomplete flows are not classified as failures from these
aggregate counts. Fresh Supabase request logs could not be reviewed because
its browser session is signed out; do not claim an OTP delivery canary.

## Validation and delivery

The previous PR #18 commit `3a619aa` passed independent release CI run
[38020971902](https://github.com/lizwashedup/WashedUp/actions/runs/38020971902).
This additional patch needs its own completed CI result before integration.
New focused regressions fail11cases against that previous source and pass
all163cases with this patch. Full-suite/type/export/guard outcomes are recorded
in the evidence and final PR description, not inferred from these tests.

No native, dependency, auth provider, database policy/schema or account data
changes are part of this patch. No messages, OTPs or notifications were sent.
The existing iOS Build51 guarded OTA process applies after final checks on
clean merged main, with exact-artifact Sentry maps. Publication is still
blocked on the unavailable upload credential. Android has no verified OTA
target. Native4X/navigation and keyboard/clipboard work remain separately
open and cannot be delivered through this JavaScript update.

Rollback remains the October8group `efe45b8c-c6ed-4a3e-ac5c-5a62abe5aeb8`.
The historical protected release branch remains `9c2994b` and untouched.
Evidence: `/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/sentry-repair-20261010/`.
