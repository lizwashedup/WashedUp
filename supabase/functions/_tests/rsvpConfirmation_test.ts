import {
  renderRsvpConfirmation,
  RSVP_CONFIRMATION_MAX_ATTEMPTS,
  RSVP_CONFIRMATION_TIMEOUT_MS,
  rsvpConfirmationIdempotencyKey,
  rsvpConfirmationRetryDelaySeconds,
  shouldRetryRsvpProviderStatus,
} from "../_shared/rsvpConfirmation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("free RSVP idempotency is stable per event and user", () => {
  assert(
    rsvpConfirmationIdempotencyKey("event-1", "user-1") ===
      "free-rsvp/event-1/user-1",
    "unexpected idempotency key",
  );
});

Deno.test("free RSVP email uses registration language and creator details", () => {
  const rendered = renderRsvpConfirmation({
    title: "Sunset picnic",
    eventDate: "Friday at 6 PM",
    venue: "Elysian Park",
    creatorNote: "Bring a blanket",
    eventId: "event-1",
  });
  const allCopy = `${rendered.subject}\n${rendered.text}\n${rendered.html}`
    .toLowerCase();
  assert(
    allCopy.includes("you're registered"),
    "registration language missing",
  );
  assert(allCopy.includes("bring a blanket"), "creator note missing");
  assert(
    !allCopy.includes("you bought"),
    "free RSVP copy must not use purchase language",
  );
  assert(
    !allCopy.includes("order total"),
    "free RSVP copy must not imply payment",
  );
});

Deno.test("free RSVP email escapes creator-authored HTML", () => {
  const rendered = renderRsvpConfirmation({
    title: "<script>alert(1)</script>",
    creatorNote: "<img src=x onerror=alert(1)>",
    eventId: "event-1",
  });
  assert(!rendered.html.includes("<script>"), "title HTML was not escaped");
  assert(
    !rendered.html.includes("<img src=x"),
    "creator note HTML was not escaped",
  );
});

Deno.test("provider work is bounded and only transient statuses retry", () => {
  assert(
    RSVP_CONFIRMATION_TIMEOUT_MS === 5_000,
    "provider timeout must stay bounded",
  );
  assert(
    RSVP_CONFIRMATION_MAX_ATTEMPTS === 8,
    "durable attempts must stay bounded",
  );
  assert(shouldRetryRsvpProviderStatus(429), "rate limit should retry");
  assert(shouldRetryRsvpProviderStatus(503), "provider outage should retry");
  assert(
    !shouldRetryRsvpProviderStatus(400),
    "invalid payload should fail terminally",
  );
});

Deno.test("retry backoff grows and caps at one hour", () => {
  assert(
    rsvpConfirmationRetryDelaySeconds(1) === 30,
    "first retry should wait 30 seconds",
  );
  assert(
    rsvpConfirmationRetryDelaySeconds(4) === 240,
    "fourth retry should wait four minutes",
  );
  assert(
    rsvpConfirmationRetryDelaySeconds(99) === 3_600,
    "retry delay must cap at one hour",
  );
});
