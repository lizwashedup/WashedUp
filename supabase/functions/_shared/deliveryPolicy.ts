/** Policy boundary between transactional delivery and marketing audience sync. */
export type AudienceContact = {
  email: string;
  first_name: string;
  last_name: string;
  unsubscribed: boolean;
};

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function audienceContactForProfile(profile: {
  email?: unknown;
  first_name_display?: unknown;
  last_name?: unknown;
  marketing_opt_in?: unknown;
}): AudienceContact | null {
  const email = normalizeEmail(profile.email);
  if (!email) return null;
  return {
    email,
    first_name: typeof profile.first_name_display === "string"
      ? profile.first_name_display.trim()
      : "",
    last_name: typeof profile.last_name === "string"
      ? profile.last_name.trim()
      : "",
    unsubscribed: profile.marketing_opt_in !== true,
  };
}

/** Transactional RSVP delivery never depends on marketing consent. */
export function maySendTransactionalRsvp(status: unknown): boolean {
  return status === "going";
}

/** A claimed-job counter is valid only after the guarded update returns its id. */
export function confirmedJobUpdate(
  updated: { id?: number } | null | undefined,
  error: unknown,
  expectedId: number,
): boolean {
  return !error && updated?.id === expectedId;
}
