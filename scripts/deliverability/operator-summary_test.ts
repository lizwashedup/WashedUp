// @ts-nocheck -- This is a Deno test, not Expo application code.
import { aggregateOperatorResponses } from "./operator-summary.ts";
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
Deno.test("aggregates paid and free failures", () => {
  const summary = aggregateOperatorResponses({
    paid: { drained: 3, failed: 1, skipped: 0, batch: 4 },
    free: {
      claimed: 2,
      delivered: 1,
      retried: 0,
      failed: 0,
      cancelled: 0,
      failures: [{
        jobId: 42,
        action: "state_update_failed",
        reason: "update not confirmed",
      }],
    },
  });
  assert(summary.paid.failed === 1, "paid failure count missing");
  assert(summary.free.failures.length === 1, "free failure entry missing");
  assert(summary.totals.unhealthy === 2, "combined unhealthy count incorrect");
  assert(
    summary.totals.hasFailures,
    "combined failure state must be unhealthy",
  );
  assert(summary.actions.length === 2, "both failures must be actionable");
});
Deno.test("empty responses stay healthy", () => {
  const summary = aggregateOperatorResponses({
    paid: { drained: 0, failed: 0, skipped: 0, batch: 0 },
    free: {
      claimed: 0,
      delivered: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
      failures: [],
    },
  });
  assert(summary.totals.unhealthy === 0, "empty response must be healthy");
  assert(!summary.totals.hasFailures, "empty response must not fail");
});

Deno.test("missing, error, and malformed responses fail closed", () => {
  const missing = aggregateOperatorResponses({});
  assert(missing.totals.hasFailures, "missing responses must fail");
  assert(missing.actions.length === 2, "both unavailable queues need actions");

  const errors = aggregateOperatorResponses({
    paid: { error: "auth failed" },
    free: { error: "claim failed" },
  });
  assert(errors.totals.hasFailures, "error responses must fail");

  const malformed = aggregateOperatorResponses({
    paid: { drained: 0, failed: "0", skipped: 0, batch: 0 },
    free: {
      claimed: 0,
      delivered: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
      failures: "none",
    },
  });
  assert(malformed.totals.hasFailures, "malformed responses must fail");
});

Deno.test("queue counts and matching failure rows are not double counted", () => {
  const summary = aggregateOperatorResponses({
    paid: { drained: 0, failed: 1, skipped: 0, batch: 1 },
    free: {
      claimed: 3,
      delivered: 0,
      failed: 1,
      retried: 1,
      cancelled: 1,
      failures: [
        { jobId: 1, action: "failed", reason: "terminal" },
        { jobId: 2, action: "retry", reason: "transient" },
        { jobId: 3, action: "cancelled", reason: "RSVP cancelled" },
      ],
    },
  });
  assert(summary.totals.unhealthy === 3, "each unhealthy job must count once");
  assert(
    summary.actions.length === 3,
    "cancelled work must not become an action",
  );
});

Deno.test("uncounted state-update failures are added to queue counts", () => {
  const summary = aggregateOperatorResponses({
    paid: { drained: 0, failed: 0, skipped: 0, batch: 0 },
    free: {
      claimed: 11,
      delivered: 0,
      failed: 10,
      retried: 0,
      cancelled: 0,
      failures: [{
        jobId: 11,
        action: "state_update_failed",
        reason: "write not confirmed",
      }],
    },
  });
  assert(summary.totals.unhealthy === 11, "uncounted state failure was hidden");
});
