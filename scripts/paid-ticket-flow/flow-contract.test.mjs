import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

test('Community and Organization creation share the same draft-to-ticket journey', () => {
  const source = read('app/creator/event-form.tsx');
  assert.match(source, /const communityId = fromCommunity && community \? community\.id : null/);
  assert.match(source, /createOperatorEvent\(fields, communityId, !ticketedSetup\)/);
  assert.match(source, /router\.push\(`\/creator\/tickets\?id=\$\{newId\}&setup=1`/);
});

test('an existing event is saved before ticket setup can read it', () => {
  const source = read('app/creator/event-form.tsx');
  const start = source.indexOf('const handleOpenTickets = async');
  const save = source.indexOf('await runPaidTicketSetupHandoff', start);
  const navigate = source.indexOf('router.push(`/creator/tickets?id=${id}', start);
  assert.ok(start >= 0, 'ticket handoff is missing');
  assert.ok(save > start, 'ticket handoff does not persist the event');
  assert.ok(navigate > save, 'ticket setup opens before the event save finishes');
  assert.match(source.slice(start, navigate), /if \(!fields\.end_time\)/);
});

test('a paid tier rechecks persisted end_time immediately before its write', () => {
  const source = read('app/creator/tickets.tsx');
  const paidGuard = source.indexOf('if (draft.price_cents > 0)');
  const readiness = source.indexOf('await getPaidTicketEventReadiness(id!)', paidGuard);
  const write = source.indexOf('await createTier(id!, draft, tiers.length)', readiness);
  assert.ok(paidGuard >= 0, 'paid-tier guard is missing');
  assert.ok(readiness > paidGuard, 'paid-tier guard does not read persisted readiness');
  assert.ok(write > readiness, 'tier write can run before the persisted end-time check');
});

test('the local buyer checkout suite covers key classification and idempotency without provider access', () => {
  const source = read('supabase/functions/_tests/ticketCheckout_test.ts');
  assert.match(source, /a live key is not a test key/);
  assert.match(source, /two different buyers with the same key never collide/);
  assert.match(source, /an open session pricing a DIFFERENT total is not reusable/);

  const pkg = JSON.parse(read('package.json'));
  const command = pkg.scripts['qa:paid-ticket-flow'];
  assert.match(command, /deno test/);
  assert.doesNotMatch(command, /--allow-(?:all|net|env)|(?:^|\s)-A(?:\s|$)/);
});
