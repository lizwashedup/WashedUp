# Research-led chat reliability priorities

This is an engineering interpretation of primary references and WashedUp's local
evidence, not a claim about production failure rates or WhatsApp performance.
No production analytics or message contents were collected for this pass.

## Changes made from the research

Amazon's [idempotent API guidance](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
explains why a timed-out operation may already have succeeded, and why an
explicit client request ID is more reliable than inferring duplicate intent from
identical content. Applying that principle to WashedUp exposed a gap: voice
message retries retained the message UUID but generated a new timestamp-based
audio object path. A committed upload with a lost response could create another
object on retry. The chat now passes its existing recording-session UUID to the
upload helper, preserves the same object path and leaves upsert disabled.

Supabase documents both [named and legacy Storage error codes](https://supabase.com/docs/guides/storage/debugging/error-codes)
and a [400 duplicate-upload response](https://supabase.com/docs/guides/storage/uploads/standard-uploads).
The installed SDK can retain `ResourceAlreadyExists` in `statusCode`, where the
old photo helper expected a number. The helper now recognizes explicit duplicate
object codes and specific legacy messages. Generic conflicts, bucket conflicts,
permissions, rate limits and server errors remain failures. Only a caller that
owns a stable immutable path can opt into duplicate-as-receipt behavior.

The audio change is scoped to one unchanged recording session. It does not make
voice drafts durable across process death, verify remote bytes by checksum, or
provide a general media outbox. The legacy optional-ID audio API still uses its
old timestamp behavior; its conflicts are never silently accepted. The chat
caller supplies the stable ID. Storage bucket/folder boundaries are unchanged.

## Evidence and decisions

| Failure scenario | Evidence | Decision |
| --- | --- | --- |
| Storage commits but its response is lost | Deterministic upload fault test ends with one object key after retry | Reuse the recording session ID for upload and message |
| Different recording intent at the same time/URI | Regression requires two different keys | Generate a new session ID after confirmation/cancellation |
| Documented duplicate photo response has a named code or HTTP 400 | Tests use actual installed SDK error objects | Recognize specific duplicate responses; do not classify every 400/409 as success |
| Permission refusal resembles a wrapper error | Negative tests retain HTTP/body-level permission errors | Never use retry recovery to bypass access rules |
| Old upload completes after the room/account retires | Scope and late-result tests | Keep visit ownership checks before reads, upload, and URL use |
| WebSocket readiness misses a committed message | Prior real local service lab and hook tests | Preserve readiness/foreground history reconciliation |
| Native rapid send-and-type | Inconsistent r7 simulator behavior and invalidated automation controls | Remains unresolved; no speculative text deletion or remount |

Supabase's [Postgres Changes troubleshooting guidance](https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting)
supports treating a live event as a reason to reconcile stored state, and waiting
for backend streaming readiness. WashedUp's existing readiness/return refresh
work follows that approach. This review did not add permanent polling or more
automatic send retries, which would require separate load and intent checks.

## Next useful data

1. Measure the exact candidate in its matching test binary: time to readable
   history, first usable composer, visible local send feedback, and server
   confirmation as separate phases. Record platform, cold/warm state, message
   count, network condition, sample count, failures and cancellations. Compare
   medians and slow cases within the same conditions. Do not turn an injected
   three-second fixture delay into a production latency claim.
2. Compare rapid typing with predictive text on/off, emoji, multiline text, and
   immediate repeated words. Use a human physical-keyboard sequence alongside
   automation to distinguish an application race from automation behavior.
3. For media, inject failure separately before upload, after upload commit, after
   message commit, and after leaving the room. Require one original intent,
   truthful pending/retry feedback, and no old-account completion in a new room.
   Real storage-network and process-kill recovery remain to be validated.
4. Exercise long history while a new message, reaction, photo layout and keyboard
   change arrive. Check that reading position is preserved and controls remain
   reachable; a list mounting successfully does not prove smooth scrolling.

React Native's [performance guidance](https://reactnative.dev/docs/performance)
explains that development mode adds substantial JavaScript overhead. The current
development fixture is useful for diagnosis, but release-performance comparisons
need a matching release-mode test environment. No native build is authorized or
created here. Current diagnostics are bounded, development-only, in-memory
durations without message/account IDs; they are not production telemetry.

## Verification for this pass

Seven selected new regression executions failed against the previous committed
implementations (four negative controls passed). With the repairs, **529 tests
passed in 15 independent suites**, including chat entry/media/voice flows, main
and topic chat, Circle plan creation and other callers of the shared photo
helper. TypeScript, auth invariants, whitespace checks and offline iOS
JavaScript/Hermes export passed. Export:
`/tmp/washedup-chat-media-retry-export-20261007`.

These are fault-injection/unit/component checks; no real Storage server or
physical microphone/file/network integration was exercised in this pass. The
previous real local database/Realtime run did not enable Storage and does not
validate these upload changes. The full-repository/lint limitations and native
uncertainties in the phase-2 audit still apply. The visible r7 fixture predates
this upload follow-up and mocks media services.
