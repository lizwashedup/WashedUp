export const RSVP_CONFIRMATION_MAX_ATTEMPTS = 8;
export const RSVP_CONFIRMATION_TIMEOUT_MS = 5_000;

export type RsvpConfirmationDetails = {
  title: string;
  eventDate?: string | null;
  /** Build 35 (Screen 31) Appendix C.8.1 wants a time range; explore_events
   *  carries both columns (confirmed live: lib/creatorEvents.ts's
   *  getOperatorEvent selects start_time and end_time), so both are threaded
   *  through here rather than dropped the way the pre-Build-35 version of
   *  this file dropped them. Raw ISO timestamptz instants -- formatted to
   *  America/Los_Angeles wall-clock time internally (formatLATime below),
   *  never printed as-is. */
  startTime?: string | null;
  endTime?: string | null;
  venue?: string | null;
  venueAddress?: string | null;
  /** "From {owner_name}." (Appendix C.8.1). This is explore_events.public_name
   *  only -- the "byline law" documented at lib/ticketing.ts:1162
   *  (public_name overrides the creator's own profile name) has a fallback
   *  half that reads the creator's profile when public_name is empty; that
   *  fallback needs a second query this drain does not already make, so it
   *  is deliberately left for whoever wires that join, and the "From" line
   *  below just omits itself when ownerName is empty rather than guessing a
   *  profiles column name unverified in this file's own context. */
  ownerName?: string | null;
  creatorNote?: string | null;
  eventId: string;
};

export function rsvpConfirmationIdempotencyKey(
  eventId: string,
  userId: string,
): string {
  return `free-rsvp/${eventId}/${userId}`;
}

export function rsvpConfirmationRetryDelaySeconds(attempt: number): number {
  const boundedAttempt = Math.max(1, Math.min(attempt, 8));
  return Math.min(60 * 60, 30 * (2 ** (boundedAttempt - 1)));
}

export function shouldRetryRsvpProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 ||
    status === 429 || status >= 500;
}

/**
 * Wall-clock time in America/Los_Angeles for a raw ISO timestamptz instant.
 * explore_events.start_time/end_time are stored as instants (not LA wall
 * time), and this Deno function is its own runtime with no shared module
 * with the native app's lib/laDate.ts/formatFullDate -- the same
 * never-the-device-clock rule those apply is reimplemented here rather than
 * left undone. Normalizes ICU's narrow-no-break-space before "AM"/"PM" (its
 * exact codepoint varies by ICU data version) to a plain space so output is
 * stable across Deno runtimes.
 */
function formatLATime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(date).replace(/[\u202f\u00a0]/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Build 35 Screen 31 (confirmation email): applies the exact transactional
 * copy from Appendix C.8.1 ("Active ticket confirmation") to the free-RSVP
 * path -- the gap the delta matrix flagged as "the exact transactional copy
 * in Appendix C.8.1 is not applied." Adapted, not copied verbatim, in two
 * places the appendix's own words don't fit a free RSVP: "ticket_type" reads
 * "RSVP" (there is no paid ticket tier here), and the footer's Manage
 * ticket / Contact creator / Refund policy links are left out -- those are
 * Screen 29/30's own named destinations (the ticket wallet and ticket
 * detail screens), not something to invent a guessed URL for from inside an
 * email-rendering function. "Add to calendar" is left out for the same
 * reason: it needs timezone-safe ICS generation, which is its own scope,
 * not a copy fix. What Appendix C.8.1 asks for that IS safely buildable
 * here -- the exact subject/headline copy, the full event/time/venue block,
 * the owner byline, and a real "get directions" link off venueAddress --
 * is applied below.
 *
 * This function backs transactional-email-drain, which is UNDEPLOYED (see
 * the 2026-08-31 G0 handoff: schema applied, activation still
 * 'quarantined', this specific function never deployed) -- so this change
 * has zero effect on any real inbox until that separate, already-gated
 * rollout (G4+) proceeds. It does not touch ticket-inbox-drain's PAID
 * confirmation template, which is live in production today and out of this
 * screen's safe scope.
 */
export function renderRsvpConfirmation(details: RsvpConfirmationDetails): {
  subject: string;
  html: string;
  text: string;
} {
  const title = details.title.trim() || "your event";
  const timeRange = [details.startTime, details.endTime]
    .map((value) => (value?.trim() ? formatLATime(value.trim()) : null))
    .filter((value): value is string => Boolean(value))
    .join("-");
  const dateTimeLine = [details.eventDate?.trim(), timeRange]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const venueLine = [details.venue?.trim(), details.venueAddress?.trim()]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const ownerName = details.ownerName?.trim() || null;
  const note = details.creatorNote?.trim() || null;
  const eventUrl = `https://washedup.app/e/${
    encodeURIComponent(details.eventId)
  }`;
  const directionsUrl = details.venueAddress?.trim()
    ? `https://maps.apple.com/?daddr=${
      encodeURIComponent(details.venueAddress.trim())
    }`
    : null;

  const detailLines = [dateTimeLine, venueLine]
    .filter((value): value is string => Boolean(value))
    .map((value) =>
      `<p style="margin:4px 0;color:#78695C;">${escapeHtml(value)}</p>`
    ).join("");
  const ownerHtml = ownerName
    ? `<p style="margin:12px 0 0;color:#78695C;">From ${
      escapeHtml(ownerName)
    }.</p>`
    : "";
  const noteHtml = note
    ? `<div style="margin:20px 0;padding:14px;border-left:3px solid #D4BF82;background:#FAF5EC;"><strong>A note from the creator</strong><br>${
      escapeHtml(note)
    }</div>`
    : "";
  const directionsHtml = directionsUrl
    ? ` <a href="${directionsUrl}" style="color:#B5522E;font-weight:700;text-decoration:none;">Get directions</a>`
    : "";

  return {
    subject: `You're confirmed: ${title}`,
    html:
      `<!doctype html><html><body style="margin:0;background:#FAF5EC;color:#2C1810;font-family:Arial,sans-serif;"><div style="max-width:560px;margin:0 auto;padding:32px 20px;"><h1 style="font-size:28px;margin:0 0 12px;">You're going.</h1><p style="font-size:18px;font-weight:700;margin:0 0 4px;">${
        escapeHtml(title)
      }</p>${detailLines}${ownerHtml}${noteHtml}<p style="margin:20px 0 0;color:#2C1810;">Your RSVP is active. Open it in WashedUp for the latest event updates.</p><a href="${eventUrl}" style="display:inline-block;margin-top:16px;padding:12px 20px;background:#B5522E;color:#FFFFFF;text-decoration:none;border-radius:14px;font-weight:700;">View in WashedUp</a>${directionsHtml}<p style="margin-top:28px;color:#78695C;font-size:13px;">This is a transactional RSVP confirmation from WashedUp.</p></div></body></html>`,
    text: [
      "You're going.",
      title,
      dateTimeLine || null,
      venueLine || null,
      ownerName ? `From ${ownerName}.` : null,
      note ? `A note from the creator: ${note}` : null,
      "Your RSVP is active. Open it in WashedUp for the latest event updates.",
      `View in WashedUp: ${eventUrl}`,
      directionsUrl ? `Get directions: ${directionsUrl}` : null,
    ].filter((value): value is string => Boolean(value)).join("\n"),
  };
}
