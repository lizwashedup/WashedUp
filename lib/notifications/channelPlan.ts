export type NotificationChannel = 'in_app' | 'push' | 'email' | 'sms';

export interface NotificationRequest {
  logicalId: string;
  userId: string;
  priority: number;
  createdAtMs: number;
  expiresAtMs: number | null;
  requestedChannels: readonly NotificationChannel[];
}

export interface NotificationPolicy {
  enabled: Record<NotificationChannel, boolean>;
  consented: Record<NotificationChannel, boolean>;
  legallyActivated: Record<NotificationChannel, boolean>;
  deliveredInWindow: number;
  maxInWindow: number;
  bypassBudgetAtOrAbove: number;
  quietWindow: { startMinute: number; endMinute: number; suppressBelow: number } | null;
}

export interface ExistingNotificationJob {
  idempotencyKey: string;
}

export interface PlannedNotificationJob {
  channel: NotificationChannel;
  idempotencyKey: string;
  logicalId: string;
  userId: string;
}

export interface NotificationPlan {
  jobs: PlannedNotificationJob[];
  suppressed: { channel: NotificationChannel; reason: string }[];
}

function isQuiet(minute: number, start: number, end: number): boolean {
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function planNotificationChannels(
  request: NotificationRequest,
  policy: NotificationPolicy,
  existingJobs: readonly ExistingNotificationJob[],
  nowMs: number,
  localMinuteOfDay: number,
): NotificationPlan {
  const jobs: PlannedNotificationJob[] = [];
  const suppressed: NotificationPlan['suppressed'] = [];
  const seenChannels = new Set<NotificationChannel>();
  const existingKeys = new Set(existingJobs.map((job) => job.idempotencyKey));

  for (const channel of request.requestedChannels) {
    if (seenChannels.has(channel)) continue;
    seenChannels.add(channel);
    const idempotencyKey = `${request.logicalId}:${request.userId}:${channel}`;
    let reason: string | null = null;
    if (request.expiresAtMs !== null && request.expiresAtMs <= nowMs) reason = 'expired';
    else if (!policy.enabled[channel]) reason = 'disabled';
    else if (!policy.consented[channel]) reason = 'not_consented';
    else if (!policy.legallyActivated[channel]) reason = 'not_activated';
    else if (existingKeys.has(idempotencyKey)) reason = 'duplicate';
    else if (
      policy.deliveredInWindow >= policy.maxInWindow &&
      request.priority < policy.bypassBudgetAtOrAbove
    ) reason = 'budget';
    else if (
      policy.quietWindow &&
      request.priority < policy.quietWindow.suppressBelow &&
      isQuiet(localMinuteOfDay, policy.quietWindow.startMinute, policy.quietWindow.endMinute)
    ) reason = 'quiet_window';

    if (reason) suppressed.push({ channel, reason });
    else jobs.push({ channel, idempotencyKey, logicalId: request.logicalId, userId: request.userId });
  }
  return { jobs, suppressed };
}
