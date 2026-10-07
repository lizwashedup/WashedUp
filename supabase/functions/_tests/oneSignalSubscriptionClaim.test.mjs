import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedPushSubscription } from '../_shared/oneSignalSubscriptionClaim.ts';

test('accepts only the requested enabled subscription', () => {
  assert.deepEqual(verifiedPushSubscription({ subscriptions: [
    { id: 'other', enabled: true, notification_types: 1 },
    { id: 'wanted', enabled: true, notification_types: -18 },
  ] }, 'wanted'), { id: 'wanted', enabled: true, notificationTypes: -18 });
});

test('rejects missing, malformed and disabled subscriptions', () => {
  assert.equal(verifiedPushSubscription(null, 'wanted'), null);
  assert.equal(verifiedPushSubscription({ subscriptions: [] }, 'wanted'), null);
  assert.equal(verifiedPushSubscription({
    subscriptions: [{ id: 'wanted', enabled: false }],
  }, 'wanted'), null);
});
