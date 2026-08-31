// deno-lint-ignore-file no-import-prefix
// Bounded service-only worker. Database interlocks keep new queues quarantined
// until an approved seed-only or live activation, and a durable lease prevents
// overlapping provider batches.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  boundedLimit,
  providerResult,
  shouldCreateAfterPatch,
} from "../_shared/audienceSync.ts";
import { fetchWithTimeout } from "../_shared/fetchWithTimeout.ts";
import { isAuthorizedRunToken } from "../_shared/runTokenAuth.ts";

const audienceId = Deno.env.get("RESEND_AUDIENCE_ID") ?? "";
const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
const timeoutMs = 10_000;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type ReconciliationJob = {
  id: number;
  provider_contact_id: string;
  expected_audience_id: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (
    !isAuthorizedRunToken(
      req.headers.get("x-run-token"),
      Deno.env.get("AUDIENCE_SYNC_RUN_TOKEN"),
    )
  ) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!apiKey || !audienceId) {
    return json({ error: "provider configuration unavailable" }, 503);
  }
  const limit = boundedLimit(
    (await req.json().catch(() => ({}))).limit,
    10,
    10,
  );
  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: leaseToken, error: leaseError } = await service.rpc(
    "acquire_delivery_worker_lease",
    { p_worker_name: "audience_sync", p_lease_seconds: 300 },
  );
  if (leaseError) return json({ error: "worker lease failed" }, 500);
  if (!leaseToken) return json({ busy: true, claimed: 0 }, 202);

  try {
    const counters = {
      claimed: 0,
      confirmed: 0,
      retryable: 0,
      terminal: 0,
      state_update_failed: 0,
      reconciliation_claimed: 0,
      reconciliation_confirmed: 0,
      reconciliation_deferred: 0,
      reconciliation_queued: 0,
      quarantine_resolved: 0,
    };

    const { data: quarantineResolved, error: quarantineError } = await service
      .rpc(
        "reconcile_quarantined_audience_events",
        { p_batch_size: Math.min(limit, 10) },
      );
    if (quarantineError) {
      return json({ error: "quarantine reconciliation failed" }, 500);
    }
    counters.quarantine_resolved = Number(quarantineResolved ?? 0);

    const { data: reconciliationRows, error: reconciliationClaimError } =
      await service.rpc(
        "claim_audience_contact_reconciliations",
        { p_batch_size: Math.min(limit, 5), p_lease_seconds: 600 },
      );
    if (reconciliationClaimError) {
      return json({ error: "reconciliation claim failed" }, 500);
    }
    const reconciliations = (reconciliationRows ?? []) as ReconciliationJob[];
    counters.reconciliation_claimed = reconciliations.length;
    for (const job of reconciliations) {
      const response = await fetchWithTimeout(
        `https://api.resend.com/audiences/${audienceId}/contacts/${
          encodeURIComponent(job.provider_contact_id)
        }`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
          timeoutMs,
        },
      );
      const body = response?.ok
        ? await response.json().catch(() => ({})) as Record<string, unknown>
        : {};
      const confirmedAudience = typeof body.audience_id === "string"
        ? body.audience_id
        : job.expected_audience_id;
      const confirmed = response?.ok === true &&
        confirmedAudience === job.expected_audience_id &&
        typeof body.unsubscribed === "boolean";
      const { data: completed, error } = await service.rpc(
        "complete_audience_contact_reconciliation",
        {
          p_id: job.id,
          p_provider_unsubscribed: confirmed ? body.unsubscribed : false,
          p_confirmed_audience_id: confirmedAudience,
          p_confirmed: confirmed,
          p_error: confirmed
            ? null
            : `provider status ${response?.status ?? "timeout"}`,
        },
      );
      if (error) counters.state_update_failed += 1;
      else if (completed === true) counters.reconciliation_confirmed += 1;
      else counters.reconciliation_deferred += 1;
    }

    const { data: jobs, error: claimError } = await service.rpc(
      "claim_audience_sync_jobs",
      {
        p_batch_size: limit,
        p_lease_seconds: 600,
      },
    );
    if (claimError) return json({ error: "claim failed" }, 500);
    counters.claimed = jobs?.length ?? 0;
    for (const job of jobs ?? []) {
      const email = typeof job.normalized_email === "string"
        ? job.normalized_email
        : "";
      if (!email || !job.id) continue;
      const contact = {
        email,
        unsubscribed: job.desired_marketing_opt_in !== true,
      };
      const url = `https://api.resend.com/audiences/${audienceId}/contacts/${
        encodeURIComponent(email)
      }`;
      let response = await fetchWithTimeout(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(contact),
        timeoutMs,
      });
      let operation = "updated";
      if (response?.status && shouldCreateAfterPatch(response.status)) {
        response = await fetchWithTimeout(
          `https://api.resend.com/audiences/${audienceId}/contacts`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(contact),
            timeoutMs,
          },
        );
        operation = "created";
      }
      const result = response
        ? providerResult(response.status, operation === "updated")
        : { kind: "retryable" as const, reason: "provider timeout" };
      const outcome = result.kind === "confirmed" ? "succeeded" : result.kind;
      const { data: completed, error: completionError } = await service.rpc(
        "complete_audience_sync_job",
        {
          p_id: job.id,
          p_revision: job.revision,
          p_outcome: outcome,
          p_confirmed: result.kind === "confirmed",
          p_error: result.kind === "confirmed" ? null : result.reason,
        },
      );
      if (completionError) {
        counters.state_update_failed += 1;
        continue;
      }
      if (completed !== true) {
        counters.reconciliation_queued += 1;
        continue;
      }
      counters[result.kind] += 1;
    }
    return json(counters);
  } finally {
    await service.rpc("release_delivery_worker_lease", {
      p_worker_name: "audience_sync",
      p_lease_token: leaseToken,
    });
  }
});
