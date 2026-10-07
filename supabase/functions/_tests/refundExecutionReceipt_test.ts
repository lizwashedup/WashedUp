import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Run with Node's built-in test runner. The optional source root lets an
// isolated test exercise the current canonical files without copying over
// unrelated work. After integration, the default is this tree's functions.
const functionsRoot = process.env.REFUND_EXECUTION_SOURCE_ROOT
  ?? fileURLToPath(new URL('../', import.meta.url));
const handlerPath = resolve(functionsRoot, 'ticket-refund/index.ts');
const receiptPath = resolve(functionsRoot, '_shared/refundRequestReceipt.ts');
const handlerSource = readFileSync(handlerPath, 'utf8');
const receiptSource = readFileSync(receiptPath, 'utf8');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
console.log(`Actual execution source SHA-256: ${hash(handlerSource)}`);
console.log(`Actual receipt helper SHA-256: ${hash(receiptSource)}`);

// No SDK is imported. Only the three known imports and TypeScript syntax
// are removed; the actual handler and actual receipt helper execute below.
const imports = [...handlerSource.matchAll(/^import .*;\r?$/gm)].map(match => match[0]);
assert.deepEqual(imports, [
  "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",
  "import Stripe from 'npm:stripe@18';",
  "import { beginRefundRequest, recordRefundRequestOutcome, refundRequestIdIsValid, refundRequestTargetHash } from '../_shared/refundRequestReceipt.ts';",
]);
assert.doesNotMatch(receiptSource, /^import\s/m);
const handlerCode = stripTypeScriptTypes(handlerSource.replace(/^import .*;\r?\n/gm, ''));
const receiptCode = stripTypeScriptTypes(receiptSource).replace(/^export /gm, '');

const ID = {
  request: '11111111-1111-4111-8111-111111111111',
  order: '22222222-2222-4222-8222-222222222222',
  creator: '33333333-3333-4333-8333-333333333333',
  delegate: '44444444-4444-4444-8444-444444444444',
  buyer: '55555555-5555-4555-8555-555555555555',
  event: '66666666-6666-4666-8666-666666666666',
  payment: 'pi_closed_fixture', refund: 're_closed_fixture', transfer: 'tr_closed_fixture', fee: 'fee_closed_fixture',
};
const reason = 'Buyer requested a refund for WU-FIXTURE1 only.';
const body = {
  action: 'refund', order_id: ID.order, client_request_id: ID.request,
  kind: 'buyer_request', position_indexes: [1], reason,
  reviewed_amount_cents: 1200, reviewed_position_count: 1,
};
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
type Row = Record<string, any>;
type Options = {
  delegate?: boolean;
  proportional?: boolean;
  insert?: 'error' | 'deferred';
  deferRefund?: boolean;
  refundError?: boolean;
  deferUpdates?: 'first' | 'all';
  recordingError?: boolean;
};

function fixture(options: Options = {}) {
  const events: string[] = [];
  const violations: string[] = [];
  const calls = { clients: [] as Row[], rpc: [] as Row[], inserts: [] as Row[], updates: [] as Row[], stripe: [] as Row[] };
  const rows = new Map<string, Row>();
  const insertGate = deferred<void>();
  const refundGate = deferred<Row>();
  const updateGates: ReturnType<typeof deferred<void>>[] = [];
  const timers = new Map<number, { ms: number; callback: () => void }>();
  const callerId = options.delegate ? ID.delegate : ID.creator;
  let timerId = 0;
  let handler!: (request: Request) => Promise<Response>;
  const trap = (name: string): never => { violations.push(name); throw new Error(`Closed fixture denied: ${name}`); };
  const env: Record<string, string> = {
    SUPABASE_URL: 'https://database.invalid', SUPABASE_ANON_KEY: 'closed-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'closed-service', STRIPE_TICKET_SECRET_KEY: 'sk_test_closed_fixture',
  };
  const computed = {
    position_count: 1, refund_amount_cents: 1200, transfer_reversal_cents: 1100,
    app_fee_refund_cents: 100, processing_shortfall_cents: 0,
    reverse_transfer_proportional: options.proportional ?? false,
    refund_application_fee_full: options.proportional ?? false,
  };
  const order = {
    id: ID.order, status: 'paid', buyer_user_id: ID.buyer,
    stripe_payment_intent_id: ID.payment, event_id: ID.event,
    explore_events: { host_user_id: ID.creator, community_id: null },
  };
  const service = {
    async rpc(name: string, args: Row) {
      calls.rpc.push({ name, args: plain(args) }); events.push(`rpc:${name}`);
      switch (name) {
        case 'has_refund_authority':
          assert.deepEqual(plain(args), { p_user_id: callerId, p_event_id: ID.event });
          return { data: options.delegate ?? false, error: null };
        case 'claim_ticket_refund': return { data: 'claimed', error: null };
        case 'release_ticket_refund_claim': return { data: null, error: null };
        case 'compute_ticket_refund': return { data: plain(computed), error: null };
        case 'record_ticket_refund': return { data: options.recordingError ? null : 1, error: options.recordingError ? { code: 'CLOSED', message: 'Fictional recording failure' } : null };
        case 'record_refund_issuance': return { data: null, error: null };
        default: return trap(`RPC ${name}`);
      }
    },
    from(table: string) {
      if (!['ticket_orders', 'ticket_refund_requests'].includes(table)) return trap(`table ${table}`);
      let action = '', value: Row, columns = '';
      const filters: { column: string; values: unknown[] }[] = [];
      const matches = (row: Row) => filters.every(filter => filter.values.includes(row[filter.column]));
      const execute = async () => {
        if (table === 'ticket_orders') {
          if (action !== 'select' || columns !== 'id, status, buyer_user_id, stripe_payment_intent_id, event_id, explore_events!inner(host_user_id, community_id)') return trap('order query');
          assert.deepEqual(filters, [{ column: 'id', values: [ID.order] }]);
          events.push('order:read'); return { data: plain(order), error: null };
        }
        if (action === 'insert') {
          calls.inserts.push(plain(value)); events.push('journal:insert:start');
          if (options.insert === 'error') return { error: { code: 'CLOSED_UNAVAILABLE' } };
          if (options.insert === 'deferred') await insertGate.promise;
          if (rows.has(value.request_id)) { events.push('journal:insert:duplicate'); return { error: { code: '23505' } }; }
          rows.set(value.request_id, plain(value)); events.push('journal:insert:saved');
          return { error: null };
        }
        if (action === 'select') {
          if (columns !== 'order_id,requester_user_id,target_hash') return trap('journal read columns');
          events.push('journal:duplicate:read');
          return { data: plain([...rows.values()].find(matches) ?? null), error: null };
        }
        if (action === 'update') {
          const call = { value: plain(value), filters: plain(filters) };
          calls.updates.push(call); events.push(`journal:update:${value.state}:start`);
          if (options.deferUpdates === 'all' || (options.deferUpdates === 'first' && calls.updates.length === 1)) {
            const gate = deferred<void>(); updateGates.push(gate); await gate.promise;
          }
          for (const row of rows.values()) if (matches(row)) Object.assign(row, plain(value));
          events.push(`journal:update:${value.state}:finished`);
          return { error: null };
        }
        return trap(`journal action ${action}`);
      };
      const query = {
        select(next: string) { action = 'select'; columns = next; return query; },
        insert(next: Row) { action = 'insert'; value = plain(next); return query; },
        update(next: Row) { action = 'update'; value = plain(next); return query; },
        eq(column: string, next: unknown) { filters.push({ column, values: [next] }); return query; },
        in(column: string, next: unknown[]) { filters.push({ column, values: plain(next) }); return query; },
        single: execute, maybeSingle: execute,
        then(yes: (value: any) => unknown, no: (error: unknown) => unknown) { return execute().then(yes, no); },
      };
      return query;
    },
  };
  const closedHttpClient = Object.freeze({ closed: true });
  class Stripe {
    static createFetchHttpClient() { return closedHttpClient; }
    constructor(key: string, config: Row) {
      assert.equal(key, env.STRIPE_TICKET_SECRET_KEY);
      assert.equal(config.httpClient, closedHttpClient);
      calls.stripe.push({ name: 'constructor' }); events.push('stripe:constructor');
    }
    paymentIntents = { retrieve: async (id: string, args: Row) => {
      calls.stripe.push({ name: 'retrieve', id, args: plain(args) }); events.push('stripe:retrieve');
      assert.equal(id, ID.payment);
      return { latest_charge: { transfer: ID.transfer, application_fee: ID.fee } };
    } };
    refunds = { create: async (args: Row, config: Row) => {
      calls.stripe.push({ name: 'refund', args: plain(args), config: plain(config) }); events.push('stripe:refund');
      if (options.refundError) throw new Error('Fictional uncertain provider transport');
      return options.deferRefund ? await refundGate.promise : { id: ID.refund };
    } };
    transfers = { createReversal: async (id: string, args: Row) => {
      calls.stripe.push({ name: 'reversal', id, args: plain(args) }); events.push('stripe:reversal');
      return { id: 'trr_closed_fixture' };
    } };
    applicationFees = { createRefund: () => trap('forbidden application fee refund') };
  }
  const context = vm.createContext({
    Request, Response, TextEncoder, crypto: webcrypto,
    Deno: new Proxy({
      env: { get(key: string) { if (!(key in env)) return trap(`environment ${key}`); return env[key]; } },
      serve(next: typeof handler) { assert.equal(handler, undefined); handler = next; },
    }, { get(target, key) { return key in target ? target[key as keyof typeof target] : trap(`Deno.${String(key)}`); } }),
    createClient(url: string, key: string, config: Row) {
      assert.equal(url, env.SUPABASE_URL); calls.clients.push({ url, key, config: plain(config) });
      if (key === env.SUPABASE_ANON_KEY) {
        assert.equal(config.global.headers.Authorization, 'Bearer closed-token');
        return { auth: { async getUser() { events.push('auth:verified'); return { data: { user: { id: callerId } }, error: null }; } } };
      }
      if (key === env.SUPABASE_SERVICE_ROLE_KEY) return service;
      return trap('client key');
    },
    Stripe,
    fetch: () => trap('network fetch'), WebSocket: class { constructor() { trap('network WebSocket'); } },
    console: { error: (...args: unknown[]) => events.push(`log:${String(args[0])}`) },
    setTimeout(callback: () => void, ms: number) {
      if (![2000, 5000].includes(ms)) return trap(`unexpected timer ${ms}`);
      const id = ++timerId; timers.set(id, { ms, callback }); return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(receiptCode, context, { filename: receiptPath });
  vm.runInContext(handlerCode, context, { filename: handlerPath });
  assert.equal(typeof handler, 'function');
  return {
    calls, rows, events, updateGates, insertGate, refundGate, callerId,
    async run(overrides: Row = {}) {
      const response = await handler(new Request('https://refund.invalid', {
        method: 'POST', headers: { Authorization: 'Bearer closed-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...overrides }),
      }));
      return { status: response.status, body: await response.json() as Row };
    },
    async until(event: string, count = 1) {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (events.filter(value => value === event).length >= count) return;
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      assert.fail(`Did not reach ${event} (${count}); observed ${events.join(', ')}`);
    },
    expire(ms: number) {
      const active = [...timers.entries()].filter(([, timer]) => timer.ms === ms);
      assert.equal(active.length, 1, `one active ${ms}ms receipt deadline`);
      const [id, timer] = active[0]; timers.delete(id); timer.callback();
    },
    assertClosed() { assert.deepEqual(violations, []); assert.equal(timers.size, 0, 'receipt deadlines cleaned up'); },
  };
}
type Fixture = ReturnType<typeof fixture>;
const rpc = (f: Fixture, name: string) => f.calls.rpc.filter(call => call.name === name);
function assertIdentity(result: Row, callerId = ID.creator) {
  assert.equal(result.order_id, ID.order);
  assert.equal(result.client_request_id, ID.request);
  assert.equal(result.requester_user_id, callerId);
}
function assertReceiptFilters(f: Fixture) {
  for (const call of f.calls.updates) assert.deepEqual(call.filters.slice(0, 3), [
    { column: 'request_id', values: [ID.request] },
    { column: 'order_id', values: [ID.order] },
    { column: 'requester_user_id', values: [f.callerId] },
  ]);
}
function assertAccounting(f: Fixture, kind = 'buyer_request') {
  assert.deepEqual(rpc(f, 'record_ticket_refund'), [{ name: 'record_ticket_refund', args: {
    p_order_id: ID.order, p_position_indexes: [1], p_kind: kind, p_stripe_refund_id: ID.refund,
  } }]);
  assert.deepEqual(rpc(f, 'record_refund_issuance'), [{ name: 'record_refund_issuance', args: {
    p_order_id: ID.order, p_issued_by_user_id: ID.creator, p_issuer_is_owner: true,
    p_reason: reason, p_kind: kind, p_position_indexes: [1], p_refund_amount_cents: 1200, p_stripe_refund_id: ID.refund,
  } }]);
  assert.equal(rpc(f, 'release_ticket_refund_claim').length, 1);
  assertReceiptFilters(f);
}

test('execution waits for its exact pending journal insert before claim or provider dispatch', { timeout: 3000 }, async () => {
  const f = fixture({ insert: 'deferred' });
  const running = f.run();
  await f.until('journal:insert:start');
  assert.deepEqual(f.calls.stripe, []);
  assert.equal(rpc(f, 'claim_ticket_refund').length, 0);
  assert.equal(f.rows.size, 0);
  f.insertGate.resolve();
  const result = await running;
  assert.equal(result.status, 200); assert.equal(result.body.request_state, 'complete');
  assertIdentity(result.body); assertAccounting(f);
  const expectedHash = hash(JSON.stringify({ kind: 'buyer_request', positions: [1], reason, reviewedAmount: 1200, reviewedCount: 1 }));
  assert.deepEqual(f.calls.inserts, [{ request_id: ID.request, order_id: ID.order, requester_user_id: ID.creator, target_hash: expectedHash, state: 'pending' }]);
  assert.ok(f.events.indexOf('journal:insert:saved') < f.events.indexOf('rpc:claim_ticket_refund'));
  assert.ok(f.events.indexOf('journal:insert:saved') < f.events.indexOf('stripe:refund'));
  assert.deepEqual(f.calls.stripe.find(call => call.name === 'refund'), { name: 'refund', args: {
    payment_intent: ID.payment, amount: 1200, metadata: { order_id: ID.order, kind: 'buyer_request' },
  }, config: { idempotencyKey: `tr:${ID.order}:buyer_request:1` } });
  assert.equal(f.rows.get(ID.request)?.state, 'complete'); f.assertClosed();
});

for (const conflict of [false, true]) test(`an unowned ${conflict ? 'conflicting target' : 'duplicate'} cannot dispatch or settle the original in-flight journal`, { timeout: 3000 }, async () => {
  const f = fixture({ deferRefund: true });
  const original = f.run();
  await f.until('stripe:refund');
  const pending = plain(f.rows.get(ID.request));
  const providerCalls = plain(f.calls.stripe);
  const duplicate = await f.run(conflict ? { position_indexes: [2], reason: 'Different fictional target.' } : {});
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'refund request already received; check its status');
  assert.equal(duplicate.body.request_state, undefined, 'unowned request cannot attest not-started for the original');
  assert.equal(duplicate.body.client_request_id, undefined);
  assert.deepEqual(f.rows.get(ID.request), pending);
  assert.deepEqual(f.calls.stripe, providerCalls);
  assert.deepEqual(f.calls.updates, []);
  assert.equal(rpc(f, 'claim_ticket_refund').length, 1);
  assert.equal(rpc(f, 'release_ticket_refund_claim').length, 0);
  f.refundGate.resolve({ id: ID.refund });
  const result = await original;
  assert.equal(result.status, 200); assertIdentity(result.body); assertAccounting(f);
  assert.equal(f.rows.get(ID.request)?.state, 'complete'); f.assertClosed();
});

test('journal insert failure refuses execution before claim or Stripe', { timeout: 3000 }, async () => {
  const f = fixture({ insert: 'error' });
  const result = await f.run();
  assert.equal(result.status, 503); assert.equal(result.body.error, 'could not save the refund request');
  assert.equal(result.body.request_state, undefined);
  assert.deepEqual(f.calls.stripe, []); assert.deepEqual(f.calls.updates, []);
  assert.equal(rpc(f, 'claim_ticket_refund').length, 0); f.assertClosed();
});

test('journal insert deadline refuses dispatch even if the pending insert finishes late', { timeout: 3000 }, async () => {
  const f = fixture({ insert: 'deferred' });
  const running = f.run(); await f.until('journal:insert:start'); f.expire(5000);
  const result = await running;
  assert.equal(result.status, 503); assert.equal(result.body.request_state, undefined);
  f.insertGate.resolve(); await f.until('journal:insert:saved');
  assert.equal(f.rows.get(ID.request)?.state, 'pending');
  assert.deepEqual(f.calls.stripe, []); assert.deepEqual(f.calls.updates, []);
  assert.equal(rpc(f, 'claim_ticket_refund').length, 0); f.assertClosed();
});

test('journal-owned delegate reason refusal attests only its exact original identity', { timeout: 3000 }, async () => {
  const f = fixture({ delegate: true });
  const result = await f.run({ reason: '  ' });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'a reason is required when issuing a refund as a granted delegate, not the owner');
  assertIdentity(result.body, ID.delegate); assert.equal(result.body.request_state, 'not-started');
  assert.equal(f.rows.get(ID.request)?.state, 'not_started');
  assert.deepEqual(f.calls.stripe, []); assert.equal(rpc(f, 'claim_ticket_refund').length, 0);
  assertReceiptFilters(f); f.assertClosed();
});

test('journal-owned changed review refusal preserves identity and releases its acquired claim once', { timeout: 3000 }, async () => {
  const f = fixture();
  const result = await f.run({ reviewed_amount_cents: 2400 });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'refund details changed; review the amount again');
  assertIdentity(result.body); assert.equal(result.body.request_state, 'not-started');
  assert.equal(f.rows.get(ID.request)?.state, 'not_started'); assert.deepEqual(f.calls.stripe, []);
  assert.deepEqual(rpc(f, 'release_ticket_refund_claim'), [{ name: 'release_ticket_refund_claim', args: {
    p_order_id: ID.order, p_claim_key: `tr:${ID.order}:buyer_request:1`,
  } }]);
  assertReceiptFilters(f); f.assertClosed();
});

for (const proportional of [false, true]) test(`${proportional ? 'cancellation' : 'voluntary'} confirmed Stripe receipt survives journal timeout and accounting proceeds`, { timeout: 3000 }, async () => {
  const f = fixture({ proportional, deferUpdates: 'first' });
  const kind = proportional ? 'organizer_cancel' : 'buyer_request';
  const running = f.run({ kind });
  await f.until('journal:update:confirmed:start');
  assert.equal(rpc(f, 'record_ticket_refund').length, 0);
  assert.equal(f.rows.get(ID.request)?.state, 'pending');
  f.expire(2000);
  const result = await running;
  assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  assert.equal(result.body.stripe_refund_id, ID.refund); assert.equal(result.body.request_state, 'complete');
  assertIdentity(result.body); assertAccounting(f, kind);
  assert.equal(f.calls.stripe.filter(call => call.name === 'refund').length, 1);
  if (proportional) {
    assert.equal(f.calls.stripe.filter(call => call.name === 'retrieve' || call.name === 'reversal').length, 0);
    const refund = f.calls.stripe.find(call => call.name === 'refund')!;
    assert.equal(refund.args.reverse_transfer, true); assert.equal(refund.args.refund_application_fee, true);
  } else {
    assert.deepEqual(f.calls.stripe.find(call => call.name === 'reversal'), { name: 'reversal', id: ID.transfer, args: {
      amount: 1100, metadata: { order_id: ID.order, stripe_refund_id: ID.refund },
    } });
    assert.ok(f.events.indexOf('stripe:reversal') < f.events.indexOf('rpc:record_ticket_refund'));
  }
  assert.equal(f.rows.get(ID.request)?.state, 'complete');
  f.updateGates[0].resolve(); await f.until('journal:update:confirmed:finished');
  assert.equal(f.rows.get(ID.request)?.state, 'complete', 'late confirmed write cannot downgrade completed journal');
  assert.equal(f.rows.get(ID.request)?.refund_amount_cents, 1200);
  assert.equal(f.rows.get(ID.request)?.positions_voided, 1); f.assertClosed();
});

test('recording failure after Stripe retains the known refund identity despite both journal write deadlines', { timeout: 3000 }, async () => {
  const f = fixture({ deferUpdates: 'all', recordingError: true });
  const running = f.run(); await f.until('journal:update:confirmed:start'); f.expire(2000);
  await f.until('journal:update:confirmed:start', 2); f.expire(2000);
  const result = await running;
  assert.equal(result.status, 500); assert.equal(result.body.error, 'refund succeeded at stripe but recording failed');
  assertIdentity(result.body); assert.equal(result.body.stripe_refund_id, ID.refund);
  assert.equal(result.body.request_state, 'confirmed'); assert.equal(result.body.ok, undefined);
  assert.equal(rpc(f, 'record_ticket_refund').length, 1);
  assert.equal(rpc(f, 'record_ticket_refund')[0].args.p_stripe_refund_id, ID.refund);
  assert.equal(rpc(f, 'record_refund_issuance').length, 0);
  assert.equal(rpc(f, 'release_ticket_refund_claim').length, 1);
  assert.equal(f.calls.stripe.filter(call => call.name === 'refund').length, 1);
  assert.equal(f.calls.stripe.filter(call => call.name === 'reversal').length, 1);
  assert.equal(f.rows.get(ID.request)?.state, 'pending');
  f.updateGates.forEach(gate => gate.resolve()); await f.until('journal:update:confirmed:finished', 2);
  assert.equal(f.rows.get(ID.request)?.state, 'confirmed'); assertReceiptFilters(f); f.assertClosed();
});

test('uncertain Stripe dispatch leaves its journal pending and never falsely settles not-started', { timeout: 3000 }, async () => {
  const f = fixture({ refundError: true });
  const result = await f.run();
  assert.equal(result.status, 502); assertIdentity(result.body);
  assert.equal(result.body.request_state, 'unknown'); assert.equal(result.body.stripe_refund_id, undefined);
  assert.equal(f.rows.get(ID.request)?.state, 'pending'); assert.deepEqual(f.calls.updates, []);
  assert.equal(rpc(f, 'record_ticket_refund').length, 0);
  assert.equal(rpc(f, 'release_ticket_refund_claim').length, 1); f.assertClosed();
});
