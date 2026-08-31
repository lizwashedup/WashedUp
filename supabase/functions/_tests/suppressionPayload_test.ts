const assert = (value: unknown, message?: string) => {
  if (!value) throw new Error(message ?? "assertion failed");
};
import {
  providerEventScope,
  suppressionEmail,
} from "../_shared/suppressionPayload.ts";

Deno.test("suppression payload extracts string and array recipients", () => {
  assert(
    suppressionEmail("email.bounced", { to: " A@Example.com " }) ===
      "a@example.com",
  );
  assert(
    suppressionEmail("email.complained", {
      to: [" B@Example.com ", "other@example.com"],
    }) === "b@example.com",
  );
});

Deno.test("provider event scope extracts only explicit ownership evidence", () => {
  const contact = providerEventScope("contact.updated", {
    contact: {
      id: "contact-1",
      audience_id: "audience-1",
    },
  });
  assert(contact.contactId === "contact-1");
  assert(contact.audienceId === "audience-1");

  const email = providerEventScope("email.bounced", {
    email_id: "email-1",
    bounce: { type: "permanent" },
    tags: [{ name: "application", value: "washedup" }],
  });
  assert(email.messageId === "email-1");
  assert(email.applicationTag === "washedup");
  assert(email.permanentBounce === true);

  const unscoped = providerEventScope("email.bounced", {
    bounce: { type: "transient" },
    tags: [{ name: "application", value: "somewhere-else" }],
  });
  assert(unscoped.applicationTag === null);
  assert(unscoped.permanentBounce === false);
});

Deno.test("contact.updated only records explicit unsubscribe", () => {
  assert(
    suppressionEmail("contact.updated", {
      email: "a@example.com",
      unsubscribed: false,
    }) === null,
  );
  assert(
    suppressionEmail("contact.updated", {
      email: " A@Example.com ",
      unsubscribed: true,
    }) === "a@example.com",
  );
});
