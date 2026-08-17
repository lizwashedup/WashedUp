export type WalletPlatform = 'apple' | 'google';
export type WalletTicketStatus = 'confirmed' | 'cancelled' | 'refunded';

export interface WalletTicket {
  ticketId: string;
  orderId: string;
  status: WalletTicketStatus;
  admissionReference: string | null;
}

export interface WalletDeliveryAttempt {
  idempotencyKey: string;
  state: 'queued' | 'delivered' | 'retryable' | 'failed';
  attemptCount: number;
  retryAtMs: number | null;
}

export interface WalletDeliveryPolicy {
  enabled: Record<WalletPlatform, boolean>;
  maxAttempts: number;
}

export type WalletDeliveryPlan =
  | { eligible: true; idempotencyKey: string; platform: WalletPlatform }
  | { eligible: false; reason: string };

export function planWalletDelivery(
  ticket: WalletTicket,
  platform: WalletPlatform,
  passVersion: number,
  attempts: readonly WalletDeliveryAttempt[],
  policy: WalletDeliveryPolicy,
  nowMs: number,
): WalletDeliveryPlan {
  if (!policy.enabled[platform]) return { eligible: false, reason: 'disabled' };
  if (ticket.status !== 'confirmed') return { eligible: false, reason: ticket.status };
  if (!ticket.ticketId || !ticket.orderId || !ticket.admissionReference) {
    return { eligible: false, reason: 'incomplete_ticket' };
  }
  if (!Number.isInteger(passVersion) || passVersion < 1) {
    return { eligible: false, reason: 'invalid_version' };
  }

  const idempotencyKey = `${platform}:${ticket.ticketId}:v${passVersion}`;
  const existing = attempts.find((attempt) => attempt.idempotencyKey === idempotencyKey);
  if (existing?.state === 'delivered') return { eligible: false, reason: 'delivered' };
  if (existing?.state === 'queued') return { eligible: false, reason: 'queued' };
  if (existing && existing.attemptCount >= policy.maxAttempts) {
    return { eligible: false, reason: 'attempt_limit' };
  }
  if (existing?.state === 'retryable' && existing.retryAtMs !== null && existing.retryAtMs > nowMs) {
    return { eligible: false, reason: 'retry_not_due' };
  }
  if (existing?.state === 'failed') return { eligible: false, reason: 'failed' };
  return { eligible: true, idempotencyKey, platform };
}
