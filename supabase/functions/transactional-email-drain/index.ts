import { parsePageInvitationDispatch, renderPageInvitationEmail } from '../_shared/pageInvitationEmail.ts';
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

import {
  parseCreatorSaleDispatch,
  renderCreatorSaleEmail,
} from "../_shared/creatorSaleEmail.ts";

const BATCH_SIZE = 10;
const CONFIRMATION_FROM = "washedup <events@washedup.app>";

type DeliveryJob = {
  id: number;
  kind: "free_event_rsvp" | "creator_ticket_sale" | "page_team_invitation";
  page_invitation_id?: string;
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
    // Explicit rollout gate: old deployed workers continue claiming only RSVPs.
    // A missing sale RPC must not strand the already claimed buyer confirmations.
    let saleClaimFailed = false;
    if (Deno.env.get("CREATOR_SALE_EMAIL_DELIVERY_ENABLED") === "true") {
      const sales = await service.rpc("claim_creator_sale_email_jobs", {
        p_batch_size: BATCH_SIZE,
        p_lease_seconds: 300,
      });
      if (sales.error) saleClaimFailed = true;
      else jobs.push(...((sales.data ?? []) as DeliveryJob[]));
    }
    let invitationClaimFailed = false;
    if (Deno.env.get("PAGE_INVITATION_EMAIL_DELIVERY_ENABLED") === "true") {
      const invitations = await service.rpc("claim_page_invitation_email_jobs", {p_batch_size:BATCH_SIZE,p_lease_seconds:300});
      if (invitations.error) invitationClaimFailed = true;
      else jobs.push(...((invitations.data ?? []) as DeliveryJob[]));
    }
    const counts = {
      claimed: jobs.length,
      delivered: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
      paused: 0,
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

      let email: string;
      let rendered: { subject: string; html: string; text: string };
      let idempotencyKey: string;
      if (job.kind === "page_team_invitation") {
        const source = await service.rpc("get_page_invitation_email_dispatch", {
          p_job_id: job.id,
          p_attempt: job.attempts,
        });
        if (source.error) {
          await retry("invitation eligibility read failed");
          continue;
        }
        const decision = parsePageInvitationDispatch(
          source.data,
          job.page_invitation_id ?? "",
          job.user_id,
        );
        if (!decision) {
          await fail("invalid invitation dispatch receipt");
          continue;
        }
        if (decision.decision === "pause") {
          // Keep the claim counter monotonic so an older worker cannot own a later attempt.
          const updated = await guardedUpdate({
            status: "pending",
            claimed_at: null,
            available_at: new Date(Date.now() + 300_000).toISOString(),
            last_error: "invitation delivery paused",
          });
          if (updated) counts.paused += 1;
          else {
            failures.push({
              jobId: job.id,
              eventId: job.explore_event_id,
              userId: job.user_id,
              action: "state_update_failed",
              reason: "pause-state update could not be confirmed",
            });
          }
          continue;
        }
        if (decision.decision === "cancel") {
          const updated = await guardedUpdate({
            status: "cancelled",
            claimed_at: null,
            available_at: null,
            last_error: decision.reason,
          });
          if (updated) counts.cancelled += 1;
          else {failures.push({
              jobId: job.id,
              eventId: job.explore_event_id,
              userId: job.user_id,
              action: "state_update_failed",
              reason: "cancelled-state update could not be confirmed",
            });}
          continue;
        }
        email = decision.email;
        rendered = renderPageInvitationEmail(decision);
        idempotencyKey = decision.idempotencyKey;

      } else if (job.kind === "creator_ticket_sale") {
        const source = await service.rpc("get_creator_sale_email_dispatch", {
          p_job_id: job.id,
          p_attempt: job.attempts,
        });
        if (source.error) {
          await retry("sale eligibility read failed");
          continue;
        }
        const decision = parseCreatorSaleDispatch(
          source.data,
          job.explore_event_id,
          job.user_id,
        );
        if (!decision) {
          await fail("invalid sale dispatch receipt");
          continue;
        }
        if (decision.decision === "pause") {
          // Keep the claim counter monotonic so an older worker cannot own a later attempt.
          const updated = await guardedUpdate({
            status: "pending",
            claimed_at: null,
            available_at: new Date(Date.now() + 300_000).toISOString(),
            last_error: "sale delivery paused",
          });
          if (updated) counts.paused += 1;
          else {
            failures.push({
              jobId: job.id,
              eventId: job.explore_event_id,
              userId: job.user_id,
              action: "state_update_failed",
              reason: "pause-state update could not be confirmed",
            });
          }
          continue;
        }
        if (decision.decision === "cancel") {
          const updated = await guardedUpdate({
            status: "cancelled",
            claimed_at: null,
            available_at: null,
            last_error: decision.reason,
          });
          if (updated) counts.cancelled += 1;
          else {failures.push({
              jobId: job.id,
              eventId: job.explore_event_id,
              userId: job.user_id,
              action: "state_update_failed",
              reason: "cancelled-state update could not be confirmed",
            });}
          continue;
        }
        email = decision.email;
        rendered = renderCreatorSaleEmail(decision);
        idempotencyKey = decision.idempotencyKey;      } else if (job.kind === "free_event_rsvp") {
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
            // start_time/end_time/venue_address/public_name added for Build 35
            // Screen 31 (Appendix C.8.1 exact copy) -- all four are real,
            // already-live columns (confirmed: lib/creatorEvents.ts's
            // getOperatorEvent selects the identical set).
            .select(
              "title, event_date, start_time, end_time, venue, venue_address, public_name, confirmation_message",
            )
            .eq("id", job.explore_event_id)
            .maybeSingle(),
        ]);
        if (profileError || eventError) {
          await retry("confirmation source read failed");
          continue;
        }
        email = typeof profile?.email === "string"
          ? profile.email.trim().toLowerCase()
          : "";
        if (!email || !event) {
          await fail(
            !email ? "required account email missing" : "event missing",
          );
          continue;
        }

        rendered = renderRsvpConfirmation({
          title: event.title ?? "your event",
          eventDate: event.event_date,
          startTime: event.start_time,
          endTime: event.end_time,
          venue: event.venue,
          venueAddress: event.venue_address,
          ownerName: event.public_name,
          creatorNote: event.confirmation_message,
          eventId: job.explore_event_id,
        });
        idempotencyKey = rsvpConfirmationIdempotencyKey(
          job.explore_event_id,
          job.user_id,
        );
      } else {
        await fail("unsupported transactional email kind");
        continue;
      }
      const response = await fetchWithTimeout("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
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

    return json(200, { ...counts, failures, saleClaimFailed, invitationClaimFailed });
  } finally {
    await service.rpc("release_delivery_worker_lease", {
      p_worker_name: "transactional_email",
      p_lease_token: leaseToken,
    });
  }
});
