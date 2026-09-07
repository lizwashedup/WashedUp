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

Deno.test("free RSVP email uses Appendix C.8.1's exact copy and creator details", () => {
  const rendered = renderRsvpConfirmation({
    title: "Sunset picnic",
    eventDate: "Friday, Sep 12",
    // Realistic raw values, matching what explore_events.start_time/end_time
    // actually hold and what transactional-email-drain actually passes --
    // NOT pre-formatted display strings. Regression: an earlier version of
    // this test fed "6:00 PM" directly, which never exercised the real
    // ISO-to-LA-wall-clock formatting path and let a raw-timestamp-leak bug
    // through uncaught. 2026-09-10T18:00:00-07:00 is 6:00 PM in LA (PDT).
    startTime: "2026-09-10T18:00:00-07:00",
    endTime: "2026-09-10T21:00:00-07:00",
    venue: "Elysian Park",
    venueAddress: "1885 Angels Point Rd, Los Angeles, CA",
    ownerName: "Jamie",
    creatorNote: "Bring a blanket",
    eventId: "event-1",
  });
  const allCopy = `${rendered.subject}\n${rendered.text}\n${rendered.html}`
    .toLowerCase();
  assert(
    rendered.subject === "You're confirmed: Sunset picnic",
    "subject must match Appendix C.8.1's exact 'You're confirmed: {event_name}'",
  );
  assert(allCopy.includes("you're going"), "Appendix C.8.1 headline missing");
  assert(
    allCopy.includes("your rsvp is active"),
    "active-RSVP confirmation line missing",
  );
  assert(allCopy.includes("from jamie"), "owner byline missing");
  assert(allCopy.includes("6:00 pm-9:00 pm"), "start-end time range missing");
  assert(
    !allCopy.includes("t18:00:00") && !allCopy.includes("-07:00") &&
      !allCopy.includes("2026-09-10t"),
    "raw ISO timestamp must never leak into the rendered email -- only the formatted LA wall-clock time",
  );
  assert(
    allCopy.includes("1885 angels point rd"),
    "venue address missing",
  );
  assert(
    allCopy.includes("maps.apple.com"),
    "a real directions link should be offered when an address is known",
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

Deno.test("free RSVP email degrades gracefully when owner/time/address are unknown", () => {
  const rendered = renderRsvpConfirmation({
    title: "Sunset picnic",
    eventDate: "Friday, Sep 12",
    venue: "Elysian Park",
    eventId: "event-1",
  });
  const allCopy = `${rendered.subject}\n${rendered.text}\n${rendered.html}`
    .toLowerCase();
  assert(allCopy.includes("you're going"), "headline should still render");
  assert(
    !allCopy.includes("from ."),
    "an empty owner name must omit the From line, not render it blank",
  );
  assert(
    !allCopy.includes("maps.apple.com"),
    "no directions link should render without a real address",
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
