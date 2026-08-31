export const RSVP_CONFIRMATION_MAX_ATTEMPTS = 8;
export const RSVP_CONFIRMATION_TIMEOUT_MS = 5_000;

export type RsvpConfirmationDetails = {
  title: string;
  eventDate?: string | null;
  venue?: string | null;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderRsvpConfirmation(details: RsvpConfirmationDetails): {
  subject: string;
  html: string;
  text: string;
} {
  const title = details.title.trim() || "your event";
  const whenWhere = [details.eventDate, details.venue]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const note = details.creatorNote?.trim() || null;
  const eventUrl = `https://washedup.app/e/${
    encodeURIComponent(details.eventId)
  }`;
  const detailLines = whenWhere.map((value) =>
    `<p style="margin:4px 0;color:#78695C;">${escapeHtml(value)}</p>`
  ).join("");
  const noteHtml = note
    ? `<div style="margin:20px 0;padding:14px;border-left:3px solid #D4BF82;background:#FAF5EC;"><strong>A note from the creator</strong><br>${
      escapeHtml(note)
    }</div>`
    : "";

  return {
    subject: `You're registered for ${title}`,
    html:
      `<!doctype html><html><body style="margin:0;background:#FAF5EC;color:#2C1810;font-family:Arial,sans-serif;"><div style="max-width:560px;margin:0 auto;padding:32px 20px;"><h1 style="font-size:28px;margin:0 0 12px;">You're registered</h1><p style="font-size:18px;font-weight:700;margin:0 0 12px;">${
        escapeHtml(title)
      }</p>${detailLines}${noteHtml}<a href="${eventUrl}" style="display:inline-block;margin-top:16px;padding:12px 20px;background:#B5522E;color:#FFFFFF;text-decoration:none;border-radius:14px;font-weight:700;">View event</a><p style="margin-top:28px;color:#78695C;font-size:13px;">This is a transactional RSVP confirmation from WashedUp.</p></div></body></html>`,
    text: [
      `You're registered for ${title}`,
      ...whenWhere,
      note ? `A note from the creator: ${note}` : null,
      `View event: ${eventUrl}`,
    ].filter((value): value is string => Boolean(value)).join("\n"),
  };
}
