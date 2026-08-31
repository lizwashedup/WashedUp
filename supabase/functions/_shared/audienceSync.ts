export type AudienceSyncContact = {
  email: string;
  first_name?: string;
  last_name?: string;
  unsubscribed: boolean;
};

export type ProviderResult =
  | { kind: "confirmed"; operation: "updated" | "created"; status: number }
  | { kind: "retryable"; status?: number; reason: string }
  | { kind: "terminal"; status?: number; reason: string };

export function providerResult(status: number, patch: boolean): ProviderResult {
  if (status >= 200 && status < 300) {
    return {
      kind: "confirmed",
      operation: patch ? "updated" : "created",
      status,
    };
  }
  if (
    status === 408 || status === 409 || status === 425 || status === 429 ||
    status >= 500
  ) {
    return { kind: "retryable", status, reason: "provider temporary failure" };
  }
  return { kind: "terminal", status, reason: "provider rejected contact" };
}

export function shouldCreateAfterPatch(status: number): boolean {
  return status === 404;
}

export function syncJobOutcome(
  result: ProviderResult,
): "succeeded" | "retryable" | "terminal" {
  return result.kind === "confirmed" ? "succeeded" : result.kind;
}

export function boundedLimit(value: unknown, fallback = 25, max = 100): number {
  const n = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
  return Math.min(max, Math.max(1, n));
}
