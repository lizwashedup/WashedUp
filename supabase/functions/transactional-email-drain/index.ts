// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetchWithTimeout.ts";
import { confirmedJobUpdate } from "../_shared/deliveryPolicy.ts";
import { isAuthorizedRunToken } from "../_shared/runTokenAuth.ts";
import {
  renderRsvpConfirmation,
  RSVP_CONFIRMATION_MAX_ATTEMPTS,
  RSVP_CONFIRMATION_TIMEOUT_MS,
  rsvpConfirmationIdempotencyKey,
  rsvpConfirmationRetryDelaySeconds,
  shouldRetryRsvpProviderStatus,
} from "../_shared/rsvpConfirmation.ts";

const BATCH_SIZE = 10;
const CONFIRMATION_FROM = "washedup <events@washedup.app>";

type DeliveryJob = {
  id: number;
  user_id: string;
  explore_event_id: string;
  attempts: number;
};

type OperatorFailure = {
  jobId: number;
  eventId: string;
  userId: string;
  action: "retry" | "failed" | "cancelled" | "state_update_failed";
  reason: string;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (
    !isAuthorizedRunToken(
      req.headers.get("x-run-token"),
      Deno.env.get("TRANSACTIONAL_EMAIL_RUN_TOKEN"),
    )
  ) {
    return json(401, { error: "unauthorized" });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!url || !serviceKey || !resendKey) {
    return json(500, { error: "delivery configuration unavailable" });
  }
  const service = createClient(url, serviceKey);
  const { data: leaseToken, error: leaseError } = await service.rpc(
    "acquire_delivery_worker_lease",
    { p_worker_name: "transactional_email", p_lease_seconds: 300 },
  );
  if (leaseError) return json(500, { error: "worker lease failed" });
  if (!leaseToken) return json(202, { busy: true, claimed: 0 });

  try {
    const { data, error } = await service.rpc(
      "claim_transactional_email_jobs",
      {
        p_batch_size: BATCH_SIZE,
        p_lease_seconds: 300,
      },
    );
    if (error) return json(500, { error: "job claim failed" });

    const jobs = (data ?? []) as DeliveryJob[];
    const counts = {
      claimed: jobs.length,
      delivered: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
    };
    // Keep one concise, machine-readable failure list alongside the counters so
    // an operator can act on the exact jobs without reconstructing logs.
    const failures: OperatorFailure[] = [];

    for (const job of jobs) {
      const guardedUpdate = async (values: Record<string, unknown>) => {
        const { data: updated, error } = await service
          .from("transactional_email_jobs")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("id", job.id)
          .eq("status", "processing")
          .eq("attempts", job.attempts)
          .select("id")
          .maybeSingle();
        return confirmedJobUpdate(updated, error, job.id);
      };

      const fail = async (reason: string) => {
        const updated = await guardedUpdate({
          status: "failed",
          last_error: reason.slice(0, 500),
          available_at: null,
        });
        if (!updated) {
          failures.push({
            jobId: job.id,
            eventId: job.explore_event_id,
            userId: job.user_id,
            action: "state_update_failed",
            reason: `failed-state update could not be confirmed: ${reason}`,
          });
          return;
        }
        counts.failed += 1;
        failures.push({
          jobId: job.id,
          eventId: job.explore_event_id,
          userId: job.user_id,
          action: "failed",
          reason,
        });
      };
      const retry = async (reason: string) => {
        if (job.attempts >= RSVP_CONFIRMATION_MAX_ATTEMPTS) {
          await fail(`attempt limit reached: ${reason}`);
          return;
        }
        const availableAt = new Date(
          Date.now() + rsvpConfirmationRetryDelaySeconds(job.attempts) * 1_000,
        ).toISOString();
        const updated = await guardedUpdate({
          status: "pending",
          last_error: reason.slice(0, 500),
          available_at: availableAt,
          claimed_at: null,
        });
        if (!updated) {
          failures.push({
            jobId: job.id,
            eventId: job.explore_event_id,
            userId: job.user_id,
            action: "state_update_failed",
            reason: `retry-state update could not be confirmed: ${reason}`,
          });
          return;
        }
        counts.retried += 1;
        failures.push({
          jobId: job.id,
          eventId: job.explore_event_id,
          userId: job.user_id,
          action: "retry",
          reason,
        });
      };

      const { data: rsvp, error: rsvpError } = await service
        .from("explore_event_rsvps")
        .select("status")
        .eq("explore_event_id", job.explore_event_id)
        .eq("user_id", job.user_id)
        .maybeSingle();
      if (rsvpError) {
        await retry("RSVP state read failed");
        continue;
      }
      if (rsvp?.status !== "going") {
        const updated = await guardedUpdate({
          status: "cancelled",
          claimed_at: null,
          available_at: null,
        });
        if (!updated) {
          failures.push({
            jobId: job.id,
            eventId: job.explore_event_id,
            userId: job.user_id,
            action: "state_update_failed",
            reason: "cancelled-state update could not be confirmed",
          });
          continue;
        }
        counts.cancelled += 1;
        failures.push({
          jobId: job.id,
          eventId: job.explore_event_id,
          userId: job.user_id,
          action: "cancelled",
          reason: `RSVP status is ${rsvp?.status ?? "missing"}`,
        });
        continue;
      }

      const [
        { data: profile, error: profileError },
        { data: event, error: eventError },
      ] = await Promise.all([
        service.from("profiles").select("email").eq("id", job.user_id)
          .maybeSingle(),
        service.from("explore_events")
          .select("title, event_date, venue, confirmation_message")
          .eq("id", job.explore_event_id)
          .maybeSingle(),
      ]);
      if (profileError || eventError) {
        await retry("confirmation source read failed");
        continue;
      }
      const email = typeof profile?.email === "string"
        ? profile.email.trim().toLowerCase()
        : "";
      if (!email || !event) {
        await fail(!email ? "required account email missing" : "event missing");
        continue;
      }

      const rendered = renderRsvpConfirmation({
        title: event.title ?? "your event",
        eventDate: event.event_date,
        venue: event.venue,
        creatorNote: event.confirmation_message,
        eventId: job.explore_event_id,
      });
      const response = await fetchWithTimeout("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": rsvpConfirmationIdempotencyKey(
            job.explore_event_id,
            job.user_id,
          ),
        },
        body: JSON.stringify({
          from: CONFIRMATION_FROM,
          to: [email],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        }),
        timeoutMs: RSVP_CONFIRMATION_TIMEOUT_MS,
      });
      if (!response) {
        await retry("provider timeout or network error");
        continue;
      }
      if (!response.ok) {
        const reason = `provider status ${response.status}`;
        if (shouldRetryRsvpProviderStatus(response.status)) await retry(reason);
        else await fail(reason);
        continue;
      }
      const providerBody = await response.json().catch(() => ({})) as {
        id?: string;
      };
      if (!providerBody.id) {
        await retry("provider success missing message id");
        continue;
      }
      const delivered = await guardedUpdate({
        status: "delivered",
        provider_message_id: providerBody.id,
        delivered_at: new Date().toISOString(),
        last_error: null,
        claimed_at: null,
        available_at: null,
      });
      if (!delivered) {
        failures.push({
          jobId: job.id,
          eventId: job.explore_event_id,
          userId: job.user_id,
          action: "state_update_failed",
          reason: "delivered-state update could not be confirmed",
        });
        continue;
      }
      counts.delivered += 1;
    }

    return json(200, { ...counts, failures });
  } finally {
    await service.rpc("release_delivery_worker_lease", {
      p_worker_name: "transactional_email",
      p_lease_token: leaseToken,
    });
  }
});
