import {
  planNotificationChannels,
  type NotificationChannel,
  type NotificationPolicy,
} from '../notifications/channelPlan';

const channels: NotificationChannel[] = ['in_app', 'push', 'email', 'sms'];

function record(value: boolean): Record<NotificationChannel, boolean> {
  return Object.fromEntries(channels.map((channel) => [channel, value])) as Record<NotificationChannel, boolean>;
}

function policy(overrides: Partial<NotificationPolicy> = {}): NotificationPolicy {
  return {
    enabled: record(true),
    consented: record(true),
    legallyActivated: record(true),
    deliveredInWindow: 0,
    maxInWindow: 3,
    bypassBudgetAtOrAbove: 90,
    quietWindow: null,
    ...overrides,
  };
}

const request = {
  logicalId: 'notification-1',
  userId: 'user-1',
  priority: 20,
  createdAtMs: 100,
  expiresAtMs: 1000,
  requestedChannels: channels,
} as const;

describe('cross-channel notification plan', () => {
  it('keeps external transports hard off until each legal gate is active', () => {
    const legallyActivated = record(false);
    legallyActivated.in_app = true;
    const result = planNotificationChannels(request, policy({ legallyActivated }), [], 500, 600);
    expect(result.jobs.map((job) => job.channel)).toEqual(['in_app']);
    expect(result.suppressed).toEqual([
      { channel: 'push', reason: 'not_activated' },
      { channel: 'email', reason: 'not_activated' },
      { channel: 'sms', reason: 'not_activated' },
    ]);
  });

  it('applies consent, expiry, and one idempotency key per logical channel', () => {
    const consented = record(true);
    consented.sms = false;
    const first = planNotificationChannels(
      { ...request, requestedChannels: ['push', 'push', 'sms'] },
      policy({ consented }),
      [{ idempotencyKey: 'notification-1:user-1:push' }],
      500,
      600,
    );
    expect(first.jobs).toEqual([]);
    expect(first.suppressed).toEqual([
      { channel: 'push', reason: 'duplicate' },
      { channel: 'sms', reason: 'not_consented' },
    ]);
    const expired = planNotificationChannels(
      { ...request, requestedChannels: ['in_app'], expiresAtMs: 499 },
      policy(),
      [],
      500,
      600,
    );
    expect(expired.suppressed).toEqual([{ channel: 'in_app', reason: 'expired' }]);
  });

  it('uses caller-supplied quiet and budget thresholds without inventing defaults', () => {
    const constrained = policy({
      deliveredInWindow: 3,
      maxInWindow: 3,
      quietWindow: { startMinute: 1320, endMinute: 420, suppressBelow: 50 },
    });
    expect(planNotificationChannels(
      { ...request, requestedChannels: ['push'] }, constrained, [], 500, 60,
    ).suppressed).toEqual([{ channel: 'push', reason: 'budget' }]);
    expect(planNotificationChannels(
      { ...request, priority: 95, requestedChannels: ['push'] }, constrained, [], 500, 60,
    ).jobs).toHaveLength(1);
    expect(planNotificationChannels(
      { ...request, requestedChannels: ['push'] },
      { ...constrained, deliveredInWindow: 0 },
      [],
      500,
      60,
    ).suppressed).toEqual([{ channel: 'push', reason: 'quiet_window' }]);
  });
});
