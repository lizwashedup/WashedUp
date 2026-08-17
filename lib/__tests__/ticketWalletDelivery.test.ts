import { planWalletDelivery, type WalletDeliveryPolicy, type WalletTicket } from '../ticketWalletDelivery';

const policy: WalletDeliveryPolicy = {
  enabled: { apple: true, google: true },
  maxAttempts: 3,
};
const ticket: WalletTicket = {
  ticketId: 'ticket-1',
  orderId: 'order-1',
  status: 'confirmed',
  admissionReference: 'door-reference',
};

describe('wallet delivery reliability foundation', () => {
  it('returns a stable platform and pass-version idempotency key', () => {
    expect(planWalletDelivery(ticket, 'apple', 2, [], policy, 1_000)).toEqual({
      eligible: true,
      idempotencyKey: 'apple:ticket-1:v2',
      platform: 'apple',
    });
    expect(planWalletDelivery(ticket, 'google', 2, [], policy, 1_000)).toEqual({
      eligible: true,
      idempotencyKey: 'google:ticket-1:v2',
      platform: 'google',
    });
  });

  it('fails closed for invalid tickets, duplicate work, and exhausted retries', () => {
    expect(planWalletDelivery({ ...ticket, status: 'refunded' }, 'apple', 1, [], policy, 1_000))
      .toEqual({ eligible: false, reason: 'refunded' });
    expect(planWalletDelivery({ ...ticket, admissionReference: null }, 'apple', 1, [], policy, 1_000))
      .toEqual({ eligible: false, reason: 'incomplete_ticket' });
    expect(planWalletDelivery(ticket, 'apple', 1, [{
      idempotencyKey: 'apple:ticket-1:v1', state: 'delivered', attemptCount: 1, retryAtMs: null,
    }], policy, 1_000)).toEqual({ eligible: false, reason: 'delivered' });
    expect(planWalletDelivery(ticket, 'apple', 1, [{
      idempotencyKey: 'apple:ticket-1:v1', state: 'retryable', attemptCount: 3, retryAtMs: 500,
    }], policy, 1_000)).toEqual({ eligible: false, reason: 'attempt_limit' });
  });

  it('releases retryable work only when its caller-supplied retry time is due', () => {
    const attempts = [{
      idempotencyKey: 'apple:ticket-1:v1',
      state: 'retryable' as const,
      attemptCount: 1,
      retryAtMs: 2_000,
    }];
    expect(planWalletDelivery(ticket, 'apple', 1, attempts, policy, 1_000))
      .toEqual({ eligible: false, reason: 'retry_not_due' });
    expect(planWalletDelivery(ticket, 'apple', 1, attempts, policy, 2_000))
      .toEqual({ eligible: true, idempotencyKey: 'apple:ticket-1:v1', platform: 'apple' });
  });
});
