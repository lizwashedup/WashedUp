// deno-lint-ignore-file no-import-prefix
// Resend/Svix webhook. Read the raw body before parsing: signatures cover bytes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySvixRequest } from "../_shared/svixVerification.ts";
import {
  providerEventScope,
  suppressionEmail,
} from "../_shared/suppressionPayload.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const supported = new Set([
  "contact.updated",
  "email.bounced",
  "email.complained",
  "email.suppressed",
]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const rawBody = await req.text();
  const verification = await verifySvixRequest(rawBody, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  }, Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "");
  if (!verification.ok) return json({ error: "invalid webhook" }, 400);
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const type = typeof event.type === "string" ? event.type : "";
  if (!supported.has(type)) return json({ ok: true, ignored: true });
  const data = (event.data && typeof event.data === "object")
    ? event.data as Record<string, unknown>
    : {};
  const email = suppressionEmail(type, data);
  if (!email) return json({ ok: true, ignored: true });
  const expectedAudienceId = Deno.env.get("RESEND_AUDIENCE_ID") ?? "";
  if (!expectedAudienceId) {
    return json({ error: "webhook configuration unavailable" }, 503);
  }
  const scope = providerEventScope(type, data);
  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: disposition, error } = await service.rpc(
    "record_audience_provider_event",
    {
      p_provider_event_id: verification.eventId,
      p_event_type: type,
      p_email: email,
      p_provider_contact_id: scope.contactId,
      p_audience_id: scope.audienceId,
      p_expected_audience_id: expectedAudienceId,
      p_provider_message_id: scope.messageId,
      p_application_tag: scope.applicationTag,
      p_permanent_bounce: scope.permanentBounce,
    },
  );
  if (error) return json({ error: "record failed" }, 500);
  return json({ ok: true, disposition });
});
