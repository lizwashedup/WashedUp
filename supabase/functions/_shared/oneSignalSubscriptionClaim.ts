export type OneSignalSubscription = {
  id?: unknown;
  enabled?: unknown;
  notification_types?: unknown;
  type?: unknown;
};

export type VerifiedPushSubscription = {
  id: string;
  enabled: true;
  notificationTypes: number | null;
};

export function verifiedPushSubscription(
  payload: unknown,
  subscriptionId: string,
): VerifiedPushSubscription | null {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as any).subscriptions)) return null;
  const subscription = ((payload as any).subscriptions as OneSignalSubscription[]).find(
    (candidate) => candidate?.id === subscriptionId,
  );
  if (!subscription || subscription.enabled !== true) return null;
  return {
    id: subscriptionId,
    enabled: true,
    notificationTypes: typeof subscription.notification_types === 'number'
      ? subscription.notification_types
      : null,
  };
}
