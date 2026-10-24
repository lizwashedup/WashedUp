import { isAuthorizedRunToken } from "../_shared/runTokenAuth.ts";

type Kind = "edge" | "registration" | "delivery";
type Health = "healthy" | "unhealthy" | "unknown" | "not_evaluated";
type Alert = "not_needed" | "suppressed" | "accepted" | "failed" | "unknown";
type RpcResult = { data: unknown; error: unknown };
type Rpc = (
  name: string,
  args?: Record<string, unknown>,
) => PromiseLike<RpcResult>;
type Diagnostic = {
  healthy: boolean;
  evaluated: boolean;
  value: number;
  details: string;
  metrics: Record<string, unknown>;
  subject: string;
  html: string;
};
type Check = {
  health: Health;
  alert: Alert;
  recorded: boolean;
  metrics?: Record<string, unknown>;
  error?: string;
};
export type MonitorDependencies = {
  runToken: string | undefined;
  configured: boolean;
  // Construct the privileged client only after method/token validation.
  createRpc: () => Rpc;
  sendAlert: (subject: string, html: string) => Promise<boolean>;
  timeoutMs?: number;
};

function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function row(data: unknown): Record<string, unknown> {
  if (
    !Array.isArray(data) || data.length !== 1 || !data[0] ||
    typeof data[0] !== "object"
  ) {
    throw new Error("invalid_diagnostic");
  }
  return data[0];
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("invalid_diagnostic");
  }
  return value;
}
function ratio(value: unknown, evaluated: boolean): number | null {
  if (value === null && !evaluated) return null;
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
    value > 1
  ) throw new Error("invalid_diagnostic");
  return value;
}
function assessment(
  r: Record<string, unknown>,
): { evaluated: boolean; healthy: boolean } {
  if (typeof r.evaluated !== "boolean" || typeof r.healthy !== "boolean") {
    throw new Error("invalid_diagnostic");
  }
  return { evaluated: r.evaluated, healthy: r.healthy };
}
function diagnostic(kind: Kind, data: unknown): Diagnostic {
  if (kind === "edge") {
    if (
      !Array.isArray(data) || data.some((r) =>
        !r || typeof r !== "object" ||
        !Number.isInteger(r.status_code) || r.status_code < 400 ||
        r.status_code > 599
      )
    ) {
      throw new Error("invalid_diagnostic");
    }
    const details = `failures_15m=${data.length}`;
    const sample = data.slice(0, 5).map((r) =>
      `<li>${esc(r.created)}: HTTP ${esc(r.status_code)} <code>${
        esc(String(r.content ?? "").slice(0, 200))
      }</code></li>`
    ).join("");
    return {
      healthy: data.length === 0,
      evaluated: true,
      value: data.length,
      details,
      metrics: { failures_15m: data.length },
      subject:
        `[ALERT] Push pipeline failing: ${data.length} errors in last 15min`,
      html:
        `<h2>Push pipeline alert</h2><p>${data.length} failed edge calls in the last 15 minutes. Inspect the affected function’s authentication and transport logs.</p><ul>${sample}</ul>`,
    };
  }
  const r = row(data);
  const { healthy, evaluated } = assessment(r);
  if (kind === "registration") {
    const completed = count(r.completed_24h);
    const covered = count(r.covered_24h);
    const refreshed = count(r.refreshed_24h);
    const active = count(r.active_24h);
    const coverage = ratio(r.coverage, evaluated);
    if (covered > completed) throw new Error("invalid_diagnostic");
    const details =
      `completed_24h=${completed} covered_24h=${covered} coverage=${coverage} refreshed_24h=${refreshed} active_24h=${active} evaluated=${evaluated}`;
    return {
      healthy,
      evaluated,
      value: active,
      details,
      metrics: {
        completed_24h: completed,
        covered_24h: covered,
        coverage,
        refreshed_24h: refreshed,
        active_24h: active,
        evaluated,
      },
      subject: `[ALERT] WashedUp push signup coverage: ${covered}/${completed}`,
      html:
        `<h2>Push signup registration needs attention</h2><p>${covered} of ${completed} accounts that completed onboarding in the last 24 hours have a OneSignal subscription.</p><p>${
          esc(details)
        }</p><p>Check native permission requests, the subscription observer and authenticated device-token claims.</p>`,
    };
  }
  const recipients = count(r.recipients);
  const delivered = count(r.delivered);
  const deliveryRatio = ratio(r.ratio, evaluated);
  if (delivered > recipients) throw new Error("invalid_diagnostic");
  const details =
    `delivered=${delivered}/${recipients} ratio=${deliveryRatio} evaluated=${evaluated}`;
  return {
    healthy,
    evaluated,
    value: delivered,
    details,
    metrics: { recipients, delivered, ratio: deliveryRatio, evaluated },
    subject:
      `[ALERT] Push delivery collapsed: ${delivered}/${recipients} in 90min`,
    html:
      `<h2>Push delivery needs attention</h2><p>${delivered} of ${recipients} recipients were reported delivered in the last 90 minutes.</p><p>${
        esc(details)
      }</p><p>Check OneSignal, APNs credentials and the sending function’s authentication.</p>`,
  };
}

// A failed alert cannot prevent other checks. A timed-out record call has an
// UNKNOWN outcome; never repeat a claim which may already have committed.
async function bounded<T>(work: () => PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function check(
  kind: Kind,
  rpc: Rpc,
  deps: MonitorDependencies,
): Promise<Check> {
  const timeout = deps.timeoutMs ?? 10_000;
  let d: Diagnostic;
  try {
    const name = {
      edge: "recent_edge_function_failures",
      registration: "push_registration_health_v2",
      delivery: "push_delivery_health",
    }[kind];
    const read = await bounded(
      () => rpc(name, kind === "edge" ? { window_minutes: 15 } : undefined),
      timeout,
    );
    if (read.error) throw new Error("diagnostic_failed");
    d = diagnostic(kind, read.data);
  } catch {
    return {
      health: "unknown",
      alert: "unknown",
      recorded: false,
      error: "diagnostic_unavailable",
    };
  }
  const result: Check = {
    health: !d.healthy
      ? "unhealthy"
      : !d.evaluated
      ? "not_evaluated"
      : "healthy",
    alert: "not_needed",
    recorded: false,
    metrics: d.metrics,
  };
  let shouldAlert: boolean;
  try {
    const record = await bounded(() =>
      rpc("record_push_health", {
        p_kind: kind,
        p_unhealthy: !d.healthy,
        p_value: d.value,
        p_details: d.details,
      }), timeout);
    if (record.error || typeof record.data !== "boolean") {
      throw new Error("record_failed");
    }
    shouldAlert = record.data;
    result.recorded = true;
  } catch {
    return { ...result, alert: "unknown", error: "health_record_unconfirmed" };
  }
  if (d.healthy) return result;
  if (!shouldAlert) return { ...result, alert: "suppressed" };
  try {
    const accepted = await bounded(
      () => deps.sendAlert(d.subject, d.html),
      timeout,
    );
    return {
      ...result,
      alert: accepted ? "accepted" : "failed",
      ...(!accepted && { error: "alert_not_accepted" }),
    };
  } catch {
    return { ...result, alert: "unknown", error: "alert_acceptance_unknown" };
  }
}
// Preserve the existing summary fields for any scheduled-result consumers.
function summary(result: Check) {
  return result.metrics
    ? {
      ...result.metrics,
      healthy: result.health !== "unhealthy",
      alerted: result.alert === "accepted",
    }
    : undefined;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
export async function handleMonitorRequest(
  req: Request,
  deps: MonitorDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!deps.runToken) {
    return json({ ok: false, error: "monitor_not_configured" }, 503);
  }
  if (!isAuthorizedRunToken(req.headers.get("x-run-token"), deps.runToken)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!deps.configured) {
    return json({ ok: false, error: "monitor_not_configured" }, 503);
  }
  let rpc: Rpc;
  try {
    rpc = deps.createRpc();
  } catch {
    return json({ ok: false, error: "monitor_unavailable" }, 503);
  }
  const [edge, registration, delivery] = await Promise.all(
    (["edge", "registration", "delivery"] as const).map((kind) =>
      check(kind, rpc, deps)
    ),
  );
  const checks = { edge, registration, delivery };
  const results = Object.values(checks);
  const health: Health = results.some((r) => r.health === "unhealthy")
    ? "unhealthy"
    : results.some((r) => r.health === "unknown")
    ? "unknown"
    : results.some((r) => r.health === "not_evaluated")
    ? "not_evaluated"
    : "healthy";
  const monitoringOk = results.every((r) => r.recorded && !r.error);
  // HTTP 200 means the inspection completed, not that push is healthy. Avoid
  // feeding detected push outages back into the edge-failure diagnostic.
  return json({
    ok: monitoringOk && (health === "healthy" || health === "not_evaluated"),
    health,
    monitoringOk,
    checks,
    failures: edge.metrics?.failures_15m,
    failuresAlerted: edge.alert === "accepted",
    failuresError: edge.error,
    registration: summary(registration),
    registrationError: registration.error,
    delivery: summary(delivery),
    deliveryError: delivery.error,
  });
}
