# Audience sync local and production runbook

The audience worker is service-only and requires `x-run-token`. It claims a bounded batch from `claim_audience_sync_jobs`, updates an existing Resend contact with PATCH, and creates a contact only after PATCH returns 404. A confirmed provider response is required before a job is counted as succeeded. Deploy this worker without Supabase JWT verification because the exact non-empty run token is its guard.

The suppression endpoint is public by design, but accepts only POST requests carrying current Svix headers. It verifies the raw request body with `RESEND_WEBHOOK_SECRET`, rejects missing or stale signatures, and relies on the idempotent `record_audience_suppression` RPC. It never logs the email or provider payload. Deploy it without Supabase JWT verification because Resend cannot supply a Supabase user token; the Svix signature is its guard. Keep JWT verification enabled for `add-to-resend-audience`, which is called by a signed-in user.

Before any live run:

1. Run `npm run qa:consent-sync:local`.
2. Run `deno run --no-remote --no-config scripts/deliverability/local-canary.ts` and confirm `providerCalls`, `databaseWrites`, and `emailSends` are all zero.
3. Confirm the migration exposing `enqueue_current_profile_audience_sync(p_profile_id)`, `claim_audience_sync_jobs(p_batch_size,p_lease_seconds)`, `complete_audience_sync_job(p_id,p_revision,p_outcome,p_confirmed,p_error)`, and `record_audience_suppression(p_provider_event_id,p_event_type,p_email)` is applied before deploying functions. The completion RPC atomically queues reconciliation when it detects a stale revision.
4. Confirm the worker has `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`, and a non-empty `AUDIENCE_SYNC_RUN_TOKEN`; confirm the webhook has the Resend endpoint's matching `RESEND_WEBHOOK_SECRET`. Creating or rotating any secret is a separately approved action.
5. Register only `contact.updated`, `email.bounced`, `email.complained`, and `email.suppressed` for the webhook. Registration is a separately approved provider mutation.
6. Use a bounded run token and inspect returned confirmed, retryable, terminal, state-update-failed, and reconciliation-queued counters. Never treat claimed as delivered. A nonzero reconciliation count means a stale provider request may have landed after newer work, and the worker must run again until the queue converges. The worker claims at most 10 jobs with a 600-second lease; its provider-call ceiling is 200 seconds for a full batch.

Real provider sends, production scheduling, and webhook registration remain separately approved operational actions.
