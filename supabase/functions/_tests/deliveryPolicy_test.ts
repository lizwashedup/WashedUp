import {
  audienceContactForProfile,
  confirmedJobUpdate,
  maySendTransactionalRsvp,
  normalizeEmail,
} from "../_shared/deliveryPolicy.ts";
import { rsvpConfirmationIdempotencyKey } from "../_shared/rsvpConfirmation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("marketing audience mirrors explicit consent", () => {
  const optedIn = audienceContactForProfile({
    email: "  PERSON@Example.COM ",
    marketing_opt_in: true,
  });
  assert(optedIn?.email === "person@example.com", "email must normalize");
  assert(optedIn?.unsubscribed === false, "opt-in must be subscribed");
  const optedOut = audienceContactForProfile({
    email: "person@example.com",
    marketing_opt_in: false,
  });
  assert(optedOut?.unsubscribed === true, "opt-out must unsubscribe");
});

Deno.test("empty email never creates a marketing contact", () => {
  assert(audienceContactForProfile({ email: "  " }) === null, "blank email");
  assert(normalizeEmail(null) === "", "null email");
});

Deno.test("transactional RSVP does not depend on marketing consent", () => {
  assert(maySendTransactionalRsvp("going"), "going RSVP may be delivered");
  assert(!maySendTransactionalRsvp("cancelled"), "cancelled RSVP is stopped");
});

Deno.test("job counters require a confirmed guarded update", () => {
  assert(
    confirmedJobUpdate({ id: 7 }, null, 7),
    "matching update is confirmed",
  );
  assert(!confirmedJobUpdate(null, null, 7), "missing update is not confirmed");
  assert(
    !confirmedJobUpdate({ id: 7 }, new Error("db"), 7),
    "errored update is not confirmed",
  );
  assert(!confirmedJobUpdate({ id: 8 }, null, 7), "wrong row is not confirmed");
});

Deno.test("transactional provider key is stable for duplicate settlement replay", () => {
  const first = rsvpConfirmationIdempotencyKey("event-1", "user-1");
  assert(
    first === rsvpConfirmationIdempotencyKey("event-1", "user-1"),
    "replay must reuse key",
  );
  assert(
    first !== rsvpConfirmationIdempotencyKey("event-2", "user-1"),
    "event keys must differ",
  );
});
