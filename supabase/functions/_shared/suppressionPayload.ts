export function suppressionEmail(
  type: string,
  data: Record<string, unknown>,
): string | null {
  if (type === "contact.updated") {
    const contact = data.contact && typeof data.contact === "object"
      ? data.contact as Record<string, unknown>
      : data;
    return contact.unsubscribed === true && typeof contact.email === "string"
      ? contact.email.trim().toLowerCase() || null
      : null;
  }
  const value = data.to;
  const email = typeof value === "string"
    ? value
    : Array.isArray(value)
    ? value.find((entry): entry is string => typeof entry === "string")
    : null;
  return email?.trim().toLowerCase() || null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function providerEventScope(
  type: string,
  data: Record<string, unknown>,
): {
  contactId: string | null;
  audienceId: string | null;
  messageId: string | null;
  applicationTag: string | null;
  permanentBounce: boolean;
} {
  const contact = data.contact && typeof data.contact === "object"
    ? data.contact as Record<string, unknown>
    : {};
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const applicationTag = tags.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const tag = entry as Record<string, unknown>;
      return tag.name === "application" && tag.value === "washedup";
    })
    ? "washedup"
    : null;
  const bounce = data.bounce && typeof data.bounce === "object"
    ? data.bounce as Record<string, unknown>
    : {};
  const bounceType = text(bounce.type) ?? text(data.bounce_type);
  return {
    contactId: text(contact.id) ?? text(data.contact_id),
    audienceId: text(contact.audience_id) ?? text(data.audience_id),
    messageId: text(data.email_id) ?? text(data.message_id),
    applicationTag,
    permanentBounce: type === "email.bounced" && bounceType === "permanent",
  };
}
