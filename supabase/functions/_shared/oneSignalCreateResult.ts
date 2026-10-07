export type OneSignalCreateOutcome = 'created' | 'no-recipients' | 'unresolved';

// The HTTP API documents an empty id for a valid request with no subscribers.
// A missing/malformed receipt is not evidence that the audience was empty:
// retain it for a retry using the same notification's idempotency key.
// https://documentation.onesignal.com/reference/push-notification
export function classifyOneSignalCreateResult(payload: unknown): OneSignalCreateOutcome {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'unresolved';
  const id = (payload as Record<string, unknown>).id;
  if (typeof id === 'string' && id.trim().length > 0) return 'created';
  if (id === '') return 'no-recipients';
  return 'unresolved';
}

export function oneSignalMessageWasCreated(payload: unknown): boolean {
  return classifyOneSignalCreateResult(payload) === 'created';
}
