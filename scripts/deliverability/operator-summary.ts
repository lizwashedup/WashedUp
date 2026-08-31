// @ts-nocheck -- This is a Deno operator script, not Expo application code.
/** Pure aggregator for real paid/free drain responses; it performs no I/O. */
export type PaidDrainResponse = {
  drained?: unknown;
  failed?: unknown;
  skipped?: unknown;
  batch?: unknown;
  error?: unknown;
};
export type FreeFailure = {
  jobId?: unknown;
  eventId?: unknown;
  userId?: unknown;
  action?: unknown;
  reason?: unknown;
};
export type FreeDrainResponse = {
  claimed?: unknown;
  delivered?: unknown;
  retried?: unknown;
  failed?: unknown;
  cancelled?: unknown;
  failures?: unknown;
  error?: unknown;
};
export type OperatorSummary = {
  paid: {
    drained: number;
    failed: number;
    skipped: number;
    batch: number;
    available: boolean;
    healthy: boolean;
  };
  free: {
    claimed: number;
    delivered: number;
    retried: number;
    failed: number;
    cancelled: number;
    failures: FreeFailure[];
    available: boolean;
    healthy: boolean;
  };
  totals: { unhealthy: number; hasFailures: boolean };
  actions: string[];
};

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function failureRows(value: unknown): FreeFailure[] {
  return Array.isArray(value)
    ? value.filter((row): row is FreeFailure =>
      Boolean(row && typeof row === "object")
    )
    : [];
}

export function aggregateOperatorResponses(
  input: { paid?: PaidDrainResponse | null; free?: FreeDrainResponse | null },
): OperatorSummary {
  const paid = input.paid ?? {};
  const free = input.free ?? {};
  const failures = failureRows(free.failures);
  const paidAvailable = !paid.error &&
    isCount(paid.drained) &&
    isCount(paid.failed) &&
    isCount(paid.skipped) &&
    isCount(paid.batch);
  const freeAvailable = !free.error &&
    isCount(free.claimed) &&
    isCount(free.delivered) &&
    isCount(free.retried) &&
    isCount(free.failed) &&
    isCount(free.cancelled) &&
    Array.isArray(free.failures);
  const paidFailed = count(paid.failed);
  const freeFailed = count(free.failed);
  const freeRetried = count(free.retried);
  const actionableFailures = failures.filter((failure) =>
    failure.action !== "cancelled"
  );
  const paidSummary = {
    drained: count(paid.drained),
    failed: paidFailed,
    skipped: count(paid.skipped),
    batch: count(paid.batch),
    available: paidAvailable,
    healthy: paidAvailable && paidFailed === 0,
  };
  const freeSummary = {
    claimed: count(free.claimed),
    delivered: count(free.delivered),
    retried: freeRetried,
    failed: freeFailed,
    cancelled: count(free.cancelled),
    failures,
    available: freeAvailable,
    healthy: freeAvailable && freeFailed === 0 && freeRetried === 0 &&
      actionableFailures.length === 0,
  };
  const failedRows =
    actionableFailures.filter((failure) => failure.action === "failed").length;
  const retryRows =
    actionableFailures.filter((failure) => failure.action === "retry").length;
  const uncountedRows =
    actionableFailures.filter((failure) =>
      failure.action !== "failed" && failure.action !== "retry"
    ).length;
  const countedFreeUnhealthy = freeFailed + freeRetried;
  const unmatchedCountedRows = Math.max(0, failedRows - freeFailed) +
    Math.max(0, retryRows - freeRetried);
  const freeUnhealthy = countedFreeUnhealthy + unmatchedCountedRows +
    uncountedRows;
  const unavailableQueues = (paidAvailable ? 0 : 1) +
    (freeAvailable ? 0 : 1);
  const actions = [
    ...(!paidAvailable
      ? ["paid ticket drain response unavailable or malformed"]
      : []),
    ...(!freeAvailable
      ? ["free transactional drain response unavailable or malformed"]
      : []),
    ...(paidFailed > 0
      ? [`paid ticket drain reported ${paidFailed} failure(s)`]
      : []),
    ...actionableFailures.map((failure) =>
      `${
        failure.jobId == null
          ? "unknown job"
          : `free job ${String(failure.jobId)}`
      }: ${
        failure.reason == null ? "unspecified failure" : String(failure.reason)
      }`
    ),
    ...(countedFreeUnhealthy > failedRows + retryRows
      ? [
        `free transactional drain reported ${freeFailed} failed and ${freeRetried} retrying job(s)`,
      ]
      : []),
  ];
  return {
    paid: paidSummary,
    free: freeSummary,
    totals: {
      unhealthy: unavailableQueues + paidFailed + freeUnhealthy,
      hasFailures: !paidAvailable || !freeAvailable || paidFailed > 0 ||
        freeUnhealthy > 0,
    },
    actions,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Deno.stdin.readable.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(
    chunks.reduce((n, chunk) => n + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

if (import.meta.main) {
  const source = Deno.args[0]
    ? await Deno.readTextFile(Deno.args[0])
    : await readStdin();
  const summary = aggregateOperatorResponses(JSON.parse(source));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.totals.hasFailures) Deno.exit(1);
}
