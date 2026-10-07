import { assertEquals } from 'jsr:@std/assert';
import { verifiedPushSubscription } from '../_shared/oneSignalSubscriptionClaim.ts';

Deno.test('accepts only the requested enabled subscription', () => {
  assertEquals(verifiedPushSubscription({ subscriptions: [
    { id: 'other', enabled: true, notification_types: 1 },
    { id: 'wanted', enabled: true, notification_types: -18 },
  ] }, 'wanted'), { id: 'wanted', enabled: true, notificationTypes: -18 });
});

Deno.test('rejects missing, malformed, and disabled subscriptions', () => {
  assertEquals(verifiedPushSubscription(null, 'wanted'), null);
  assertEquals(verifiedPushSubscription({ subscriptions: [] }, 'wanted'), null);
  assertEquals(verifiedPushSubscription({ subscriptions: [{ id: 'wanted', enabled: false }] }, 'wanted'), null);
});
