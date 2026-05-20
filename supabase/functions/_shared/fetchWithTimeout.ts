// Bounded fetch for edge functions. Aborts after `timeoutMs` (default 10s) so
// a slow or hanging upstream cannot pin a Deno worker until Supabase's 60s
// edge-fn timeout fires. Resolves to `null` on both timeout AND network
// rejection; the caller logs a context-specific message and continues
// gracefully. Not for callers that need the original error to bubble (none in
// scope as of the 2026-05-19 audit).
//
// Pairs with the mobile-side `lib/withTimeout.ts` (similar shape, different
// module system).

export interface FetchWithTimeoutInit extends RequestInit {
  timeoutMs?: number;
}

export async function fetchWithTimeout(
  url: string | URL,
  init: FetchWithTimeoutInit = {},
): Promise<Response | null> {
  const { timeoutMs = 10_000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
