/**
 * Start a best-effort marketing audience sync without making the caller wait.
 * The edge function reads the freshly persisted profile, including explicit
 * opt-out and null/empty email states, and decides whether the contact needs
 * to be added, unsubscribed, or skipped.
 */
export function requestResendAudienceSync(
  invoke: () => Promise<unknown>,
  onError: (error: unknown) => void = () => undefined,
): void {
  void invoke().catch(onError);
}
