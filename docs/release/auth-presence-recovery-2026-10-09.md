# Auth and chat presence recovery — October 9, 2026

The 6:43 PM PDT read-only check found a refresh-token HTTP 500 (`unexpected
EOF`, 5:32:40 PM), an account-check HTTP 500 (6:17:04 PM), and an expired-token
403 (6:15:34 PM). Sentry also recorded handled Android chat-presence network
failure [4B](https://washedup.sentry.io/issues/7763973089/) at 5:20:43 PM,
event `ac46cee3fef64b4080712e0b555b3fdd`, embedded Android 1.0.7 (18), update
`667a2aab-8525-4675-8293-b192c9e73d54`. These are distinct observations; they
have not been attributed to the same account or request.

All four accounts created today were phone-verified and onboarding-complete.
No failed OTP/verification request appeared in the reviewed three-hour window,
and no additional signup occurred after the earlier 4:40 PM signup. This does
not establish that every attempted signup or device path succeeds.

## Verified defect and correction

The installed `@supabase/auth-js` 2.97.0 treats HTTP 500 as a permanent auth
error. A fixture against that actual SDK confirmed one refresh 500 removed
the saved session and emitted `SIGNED_OUT`. This proves a client failure
mode; it does not prove today's particular server error logged out its user.

The existing aborting fetch is extracted into `lib/supabaseFetch.ts`. Only
POST refresh-token requests to the configured project's exact token endpoint
classify server 5xx responses as transport failures. The SDK retains ownership
of its serialized refresh, rotation, bounded retry and session persistence.
Persistent failures remain errors; an expired session is not returned as a
successful authenticated session. Genuine 400/401/403 token rejection retains
the original invalidation behavior. OTP, verification, other grants, other
origins, REST writes and storage transfers are not automatically replayed.

The existing 8s request and 9s token transport ceilings and 25s lock acquisition
budget remain. Caller cancellation is preserved; completed requests now remove
their abort listener. Request-like inputs also retain their caller signal.
No credential, response body, or request body is copied into the new error.

Supabase's upstream [session-preservation repair #2436](https://github.com/supabase/supabase-js/pull/2436)
also identifies refresh 500 misclassification. This candidate uses a narrow
adapter for the installed SDK; it does not import the newer SDK's broader
session/cooldown behavior or change dependency/native runtime contracts.

## Chat presence recovery

`useActiveChatPresence` now bounds identity reads to 8s and retries transient
failures at most twice (600ms and 1,800ms backoff). Each attempt verifies the
captured account and current focus/room intent. Existing per-account queue,
same-room replacement ownership, and conditional cleanup filters remain.
Late identity replies cannot perform writes after their deadline. Real auth
rejection and permission errors are not retried. Errors remain reportable.
These retries concern only the existing idempotent presence field, never chat
messages, invitations, OTPs or other user mutations.

## Validation and delivery

- Actual-SDK fixture reproduces the old session deletion; the regression suite
  verifies recovery, persistent outage, expired-session reads, genuine token
  rejection, endpoint isolation, cancellation and the existing time ceilings.
- Focused mounted presence tests cover recovery while remaining in the room,
  retry exhaustion, focus loss, account switching, same-room replacement,
  conditional cleanup and a late/stalled identity read.
- Final test/export/CI outcomes are recorded in the PR and local evidence
  directory below. No live signup, OTP SMS or notification is sent by tests.

Based on canonical merged `11fa96f570578df512d2ed5866ec3b194f0378ba` on isolated
branch `fix/auth-presence-recovery-20261009`. The earlier chat suspension repair
from PR #17 is included in the base. The protected release branch still points
to `9c2994b10e9f263e98a262e87a9bf7a94ee941c5` and is untouched.

This candidate has no native dependency/configuration or database changes.
It is eligible for the existing iOS Build 51 OTA process after the required
checks; the production guard must still run on clean, merged `main`.
Publication still requires the unavailable Sentry upload credential for the
exact artifact's maps. Android has no verified release target here, so its
installed clients do not receive this fix through an iOS OTA.

The native navigation teardown crash 4X and native keyboard/clipboard hangs
are not fixed by these JavaScript changes. A native repair needs separate
validation and an authorized native build. Server/network failures can still
occur; this change corrects client recovery, not the provider's availability.
No Sentry issues, provider settings, monitoring or alerts are changed.

Evidence: `/Users/liz/Desktop/WashedUp_HQ/chat-verification-20261007/evidence/auth-recovery-20261009/`.
Original read-only check: `../auth-onboarding-20261009/recheck-1843.json`.
The rollback target for a later iOS publication is the still-live October 8
group `efe45b8c-c6ed-4a3e-ac5c-5a62abe5aeb8` / update
`01a11e1d-09a0-73e8-9c16-1bca74895a0d`.
