import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOneSignalCreateResult, oneSignalMessageWasCreated } from '../_shared/oneSignalCreateResult.ts';

test('counts only a created OneSignal message', () => {
  assert.equal(oneSignalMessageWasCreated({ id: 'notification-id', recipients: 2 }), true);
  assert.equal(oneSignalMessageWasCreated({ id: '', errors: ['No valid subscriptions'] }), false);
  assert.equal(oneSignalMessageWasCreated({ errors: ['No valid subscriptions'] }), false);
  assert.equal(oneSignalMessageWasCreated(null), false);
});

test('keeps an accepted message accepted when the provider reports partial recipient errors', () => {
  assert.equal(classifyOneSignalCreateResult({
    id: '22222222-2222-4222-8222-222222222222',
    errors: { invalid_aliases: { external_id: ['unreachable-fixture'] } },
  }), 'created');
});

test('recognizes the explicit empty-audience HTTP response', () => {
  assert.equal(classifyOneSignalCreateResult({ id: '' }), 'no-recipients');
  assert.equal(classifyOneSignalCreateResult({ id: '', errors: ['No valid subscriptions'] }), 'no-recipients');
});

test('does not turn incomplete or malformed receipts into a confirmed empty audience', () => {
  for (const value of [null, [], {}, false, 'id', { id: 17 }, { id: null }, { id: '  ' },
    { errors: ['Unknown error'] }, { errors: { unexpected: true } }]) {
    assert.equal(classifyOneSignalCreateResult(value), 'unresolved', JSON.stringify(value));
  }
});
