// @ts-nocheck -- This is a Deno operator script, not Expo application code.
/** Fully local deliverability canary: no network, database, provider, or email send. */
import {
  audienceContactForProfile,
  confirmedJobUpdate,
  maySendTransactionalRsvp,
} from "../../supabase/functions/_shared/deliveryPolicy.ts";
import {
  confirmationIdempotencyKey,
  settlementFalseDisposition,
} from "../../supabase/functions/_shared/confirmationRetry.ts";
import { rsvpConfirmationIdempotencyKey } from "../../supabase/functions/_shared/rsvpConfirmation.ts";
import { aggregateOperatorResponses } from "./operator-summary.ts";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail: string) =>
  results.push({ name, ok, detail });
const subscribed = audienceContactForProfile({
  email: "person@example.com",
  marketing_opt_in: true,
});
const unsubscribed = audienceContactForProfile({
  email: "person@example.com",
  marketing_opt_in: false,
});
const freeProviderKey = rsvpConfirmationIdempotencyKey("event-1", "user-1");
const paidProviderKey = confirmationIdempotencyKey("order-1");

check(
  "marketing opt-in subscribes",
  subscribed?.unsubscribed === false,
  "explicit opt-in",
);
check(
  "marketing opt-out unsubscribes",
  unsubscribed?.unsubscribed === true,
  "explicit opt-out",
);
check(
  "transactional ignores marketing opt-out",
  maySendTransactionalRsvp("going"),
  "going RSVP remains transactional",
);
check(
  "free RSVP duplicate replay reuses provider key",
  freeProviderKey === rsvpConfirmationIdempotencyKey("event-1", "user-1"),
  freeProviderKey,
);
check(
  "paid settlement replay preserves delivery",
  settlementFalseDisposition("paid") === "already_paid",
  "paid replay",
);
check(
  "paid confirmation key is stable",
  paidProviderKey === confirmationIdempotencyKey("order-1"),
  paidProviderKey,
);
check(
  "guarded update must be confirmed before counting",
  confirmedJobUpdate({ id: 7 }, null, 7) && !confirmedJobUpdate(null, null, 7),
  "matching row only",
);
check(
  "cancelled RSVP is not delivered",
  !maySendTransactionalRsvp("cancelled"),
  "cancelled",
);

const assertionFailures = results.filter((result) => !result.ok);
const operatorSummary = aggregateOperatorResponses({
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
console.log(
  JSON.stringify(
    {
      mode: "local-no-send",
      providerCalls: 0,
      databaseWrites: 0,
      emailSends: 0,
      checks: results,
      assertionFailures,
      operatorSummary,
      ok: assertionFailures.length === 0 && !operatorSummary.totals.hasFailures,
    },
    null,
    2,
  ),
);
if (assertionFailures.length > 0 || operatorSummary.totals.hasFailures) {
  Deno.exit(1);
}
