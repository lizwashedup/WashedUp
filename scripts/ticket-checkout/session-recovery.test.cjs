// Executes the actual Edge entrypoint with in-memory SDKs. No env, network,
// provider or database access; unexpected imports fail rather than fall back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const compile = file => ts.transpileModule(readFileSync(path.resolve(__dirname, '../../supabase/functions', file), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const code = compile('create-ticket-checkout/index.ts');
const helper = compile('_shared/ticketCheckout.ts');
const now = Date.parse('2026-09-16T13:00:00Z');
const open = (overrides = {}) => ({ id: 'cs_original', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/original', amount_total: 2350, ...overrides });
function fixture(options = {}) {
  const state = { calls: [], writes: [], reads: [], session: open(), saved: null, ...options };
  const order = { order_id: 'order-original', hold_id: 'hold-original', reference_code: 'REFERENCE',
    hold_expires_at: new Date(now + (options.minutes ?? 35) * 60000).toISOString(),
    is_free: false, unit_face_cents: 1000, face_cents: 2000, processing_cents: 350,
    commission_cents: 80, commission_bps_applied: 400, total_cents: 2350,
    organizer_stripe_account_id: 'acct_original', stripe_checkout_session_id: options.prior === false ? null : 'cs_original', ...options.order };
  state.saved = { ...order, qty: 2, id: order.order_id, event_id: 'event-original', tier_id: 'tier-original', buyer_user_id: 'buyer-original', status: options.savedStatus ?? 'pending', stripe_checkout_session_id: order.stripe_checkout_session_id };
  class Query {
    constructor(table, role = 'service') { this.table = table; this.role = role; this.filters = []; }
    select(columns) { this.columns = columns; return this; }
    update(value) { this.value = value; return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    is(key, value) { return this.eq(key, value); }
    maybeSingle() { return this.execute(); }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
    async execute() {
      if (this.value) {
        state.writes.push({ table: this.table, value: this.value, filters: this.filters });
        if (state.writeThrows) throw Error('private write failure');
        if (state.cancelRace && this.value.status === 'canceled') state.saved.status = 'paid';
        if (state.writeError || (state.holdError && this.table === 'ticket_holds')) return { error: new Error('private DB detail') };
        if (this.table === 'ticket_orders' && this.filters.every(([key, value]) => key === 'buyer_user_id' ? value === 'buyer-original' : state.saved[key] === value)) Object.assign(state.saved, this.value);
        return { data: this.columns ? { ...state.saved } : null, error: null };
      }
      state.reads.push({ table: this.table, role: this.role, filters: this.filters });
      if (this.table === 'explore_events') return { data: state.event === undefined ? { id: 'event-original', status: 'Live', end_time: new Date(now + 86400000).toISOString() } : state.event, error: state.eventError ? Error('private event') : null };
      if (this.table === 'ticket_holds') return { data: state.hold === undefined ? { id: order.hold_id, event_id: 'event-original', tier_id: 'tier-original', buyer_user_id: 'buyer-original', qty: 2, status: 'active', expires_at: order.hold_expires_at } : state.hold };
      if (this.table === 'profiles') return { data: { first_name_display: 'Aster' } };
      if (this.table === 'order_add_ons') return { data: [] };
      if (this.table === 'ticket_orders') return state.readError ? { error: new Error('private read detail') } : { data: state.readSaved === undefined ? state.saved : state.readSaved };
      throw Error('unexpected table');
    }
  }
  const service = { from: table => new Query(table), rpc: async (name, args) => {
    state.calls.push({ name, args });
    if (name === 'begin_ticket_checkout' || name === 'begin_free_ticket_checkout') return state.beginError ? { error: state.beginError } : { data: [order], error: null };
    if (name === 'settle_ticket_hold') return { data: true, error: null };
    throw Error('unexpected RPC');
  } };
  class Stripe {
    static createFetchHttpClient() { return {}; }
    checkout = { sessions: {
      retrieve: async id => { state.calls.push({ name: 'retrieve', id }); if (state.retrieveError) throw Error('private retrieve detail'); return state.session; },
      expire: async id => { state.calls.push({ name: 'expire', id }); if (state.expireError) throw Error('private expire detail'); return state.expiryReceipt ?? open({ status: 'expired', url: null }); },
      create: async (payload, requestOptions) => {
        state.calls.push({ name: 'create', payload, requestOptions });
        if (state.createError) throw Error('private provider detail, expires_at');
        return state.created ?? open();
      },
    } };
  }
  let handler;
  const context = { exports: {}, Response, Request, crypto: webcrypto, Date: class extends Date { static now() { return now; } }, console: { error() {}, log() {} },
    Deno: { env: { get: name => ({ STRIPE_TICKET_SECRET_KEY: options.stripeKey === undefined ? 'sk_test_fixture' : options.stripeKey, SUPABASE_URL: 'http://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture', SUPABASE_ANON_KEY: 'anon-fixture' })[name] }, serve: fn => { handler = fn; } },
    require: name => {
      if (name === '../_shared/ticketCheckout.ts') { const scope = { exports: {}, crypto: webcrypto, Date }; vm.runInNewContext(helper, scope); return scope.exports; }
      if (name === 'npm:stripe@18') return { default: Stripe };
      if (name === 'https://esm.sh/@supabase/supabase-js@2') return { createClient: (_url, key) => key === 'service-fixture' ? service : { from: table => new Query(table, 'caller'), auth: { getUser: async () => ({ data: { user: { id: 'buyer-original' } } }) } } };
      throw Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  return { state, order, async run(body = {}) {
    const response = await handler(new Request('http://fixture.invalid/checkout', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify({ tier_id: 'tier-original', qty: 2, checkout_key: 'stable-fixture-key', return_mode: 'native', ...body }) }));
    return { status: response.status, body: await response.json() };
  } };
}
const calls = (f, name) => f.state.calls.filter(c => c.name === name);
for (const minutes of [34, 20, 1]) test(`existing payable checkout resumes with ${minutes} minutes left; creation floor does not cancel it`, async () => {
  const f = fixture({ minutes }); const r = await f.run();
  assert.equal(r.status, 200); assert.equal(r.body.url, f.state.session.url);
  assert.equal(calls(f, 'create').length, 0); assert.equal(calls(f, 'expire').length, 0); assert.equal(f.state.writes.length, 0);
});
for (const session of [open({ status: 'complete' }), open({ payment_status: 'paid' })]) test(`already paid ${session.status}/${session.payment_status} never creates, expires or cancels`, async () => {
  const f = fixture({ session, minutes: 0 }); assert.equal((await f.run()).status, 409);
  assert.equal(calls(f, 'expire').length, 0); assert.equal(calls(f, 'create').length, 0); assert.equal(f.state.writes.length, 0);
});
for (const opts of [{ retrieveError: true }, { session: open({ status: null }) }, { session: open({ status: 'future' }) }, { session: open({ id: 'cs_wrong' }) }, { order: { hold_expires_at: 'invalid' } }]) test(`unknown prior session preserves order: ${JSON.stringify(opts)}`, async () => {
  const f = fixture(opts); const r = await f.run(); assert.equal(r.body.code, 'checkout_recovery_pending');
  assert.equal(calls(f, 'expire').length, 0); assert.equal(calls(f, 'create').length, 0); assert.equal(f.state.writes.length, 0);
});
for (const opts of [{ minutes: 0 }, { session: open({ amount_total: 1 }) }, { session: open({ url: null }) }]) test(`unusable open session expires before local cleanup: ${JSON.stringify(opts)}`, async () => {
  const f = fixture(opts); const r = await f.run(); assert.equal(r.body.code, 'checkout_expired');
  assert.equal(calls(f, 'expire').length, 1); assert.equal(calls(f, 'create').length, 0);
  assert.equal(f.state.writes[0].value.status, 'released'); assert.equal(f.state.writes[1].value.status, 'canceled');
});
for (const opts of [{ expireError: true }, { expiryReceipt: open() }, { expiryReceipt: open({ id: 'cs_wrong', status: 'expired' }) }, { expiryReceipt: open({ status: 'complete', payment_status: 'paid' }) }]) test(`unconfirmed expiry never cancels or replaces: ${JSON.stringify(opts)}`, async () => {
  const f = fixture({ minutes: 0, ...opts }); assert.equal((await f.run()).body.code, 'checkout_recovery_pending');
  assert.equal(f.state.writes.length, 0); assert.equal(calls(f, 'create').length, 0);
});
test('already-expired session cleans up without asking Stripe to expire it again', async () => {
  const f = fixture({ session: open({ status: 'expired' }) }); assert.equal((await f.run()).body.code, 'checkout_expired');
  assert.equal(calls(f, 'expire').length, 0); assert.equal(f.state.saved.status, 'canceled');
});
test('failed hold release retains pending order and recovery state', async () => {
  const f = fixture({ session: open({ status: 'expired' }), holdError: true }); assert.equal((await f.run()).body.code, 'checkout_recovery_pending');
  assert.equal(f.state.saved.status, 'pending'); assert.equal(f.state.writes.length, 1);
});
for (const minutes of [20, 0]) test(`missing session ID at ${minutes} minutes does not prove an earlier create failed`, async () => {
  const f = fixture({ prior: false, minutes }); assert.equal((await f.run()).body.code, 'checkout_recovery_pending');
  assert.equal(calls(f, 'create').length, 0); assert.equal(f.state.writes.length, 0);
});
test('lost create response retains hold/order and retries the same provider key and saved money', async () => {
  const f = fixture({ prior: false, createError: true });
  const first = await f.run(); assert.equal(first.body.code, 'checkout_recovery_pending'); assert.equal(f.state.writes.length, 0);
  f.state.createError = false; assert.equal((await f.run()).status, 200);
  const attempts = calls(f, 'create'); assert.equal(attempts.length, 2);
  assert.equal(attempts[0].requestOptions.idempotencyKey, 'ticket-checkout:v1:order-original');
  assert.deepEqual(attempts[0].requestOptions, attempts[1].requestOptions);
  assert.deepEqual(attempts[0].payload, attempts[1].payload);
  assert.equal(attempts[0].payload.payment_intent_data.application_fee_amount, 430);
  assert.equal(attempts[0].payload.expires_at, Math.floor(Date.parse(f.order.hold_expires_at) / 1000));
  assert.equal(f.state.saved.status, 'pending');
});
for (const opts of [{ writeError: true }, { readError: true }, { readSaved: { id: 'order-original', status: 'paid', stripe_checkout_session_id: 'cs_original' } }, { readSaved: { id: 'other', status: 'pending', stripe_checkout_session_id: 'cs_original' } }, { readSaved: { id: 'order-original', status: 'pending', stripe_checkout_session_id: 'cs_other' } }]) test(`URL withheld until exact pending binding is confirmed: ${JSON.stringify(opts)}`, async () => {
  const f = fixture({ prior: false, ...opts }); const r = await f.run(); assert.equal(r.body.code, 'checkout_recovery_pending'); assert.equal(r.body.url, undefined);
  assert(!f.state.writes.some(w => w.value.status === 'canceled' || w.value.status === 'released'));
});
test('concurrent-style repeat binding reads the existing same session without replacing it', async () => {
  const f = fixture({ prior: false }); assert.equal((await f.run()).status, 200); assert.equal((await f.run()).status, 200);
  assert.equal(f.state.saved.stripe_checkout_session_id, 'cs_original');
  for (const w of f.state.writes) assert(w.filters.some(([k, v]) => k === 'stripe_checkout_session_id' && v === null));
});
test('free ticket still settles directly without any provider session work', async () => {
  const f = fixture({ order: { is_free: true } }); const r = await f.run(); assert.equal(r.status, 200); assert.equal(r.body.free, true);
  assert.equal(calls(f, 'settle_ticket_hold').length, 1); assert.equal(calls(f, 'create').length, 0); assert.equal(calls(f, 'retrieve').length, 0);
});

test('unexpected database exception during confirmed expiry keeps recovery available', async () => {
  const f = fixture({ session: open({ status: 'expired' }), writeThrows: true });
  assert.equal((await f.run()).body.code, 'checkout_recovery_pending'); assert.equal(f.state.saved.status, 'pending');
});
test('zero-row cancellation receipt does not claim expiration after the order changed', async () => {
  const f = fixture({ session: open({ status: 'expired' }), cancelRace: true });
  assert.equal((await f.run()).body.code, 'checkout_recovery_pending'); assert.equal(f.state.saved.status, 'paid');
});
test('new provider receipt with wrong total is bound for reconciliation but never offered to buyer', async () => {
  const f = fixture({ prior: false, created: open({ amount_total: 1 }) }); const r = await f.run();
  assert.equal(r.body.code, 'checkout_recovery_pending'); assert.equal(r.body.url, undefined);
  assert.equal(f.state.saved.stripe_checkout_session_id, 'cs_original'); assert.equal(f.state.saved.status, 'pending');
});
test('private provider diagnostics are not returned as buyer copy', async () => {
  const f = fixture({ prior: false, createError: true }); const r = await f.run();
  assert(!JSON.stringify(r.body).includes('private')); assert(!JSON.stringify(r.body).includes('expires_at'));
});

const resumeId = '7dba2000-0000-4000-8000-000000000001';
const resumeFixture = opts => fixture({ minutes: 20, ...opts, order: { order_id: resumeId, ...opts?.order } });
test('original order resumes without invoking new checkout, quoting, questions, promos or stock', async () => {
  const f = resumeFixture(); const r = await f.run({ order_id: resumeId, tier_id: 'changed-tier', qty: 49, answers: [{ changed: true }], promo_code: 'EXPIRED' });
  assert.equal(r.status, 200); assert.equal(r.body.order_id, resumeId); assert.equal(r.body.url, f.state.session.url);
  assert.equal(calls(f, 'begin_ticket_checkout').length, 0); assert.equal(calls(f, 'create').length, 0); assert.equal(f.state.writes.length, 0);
  assert.deepEqual(f.state.reads.map(r => [r.table, r.role]), [['ticket_orders', 'service'], ['explore_events', 'caller'], ['ticket_holds', 'service']]);
  assert(f.state.reads[0].filters.some(([k,v]) => k === 'buyer_user_id' && v === 'buyer-original'));
});
for (const status of ['paid', 'canceled', 'refunded']) test(`resume ${status} returns original state without provider or new checkout`, async () => {
  const f = resumeFixture({ savedStatus: status }); const r = await f.run({ order_id: resumeId });
  assert.equal(r.status, 200); assert.equal(r.body.status, status); assert.equal(f.state.calls.length, 0); assert.equal(f.state.writes.length, 0); assert.equal(f.state.reads.length, 1);
});
for (const readSaved of [null, { id: resumeId, buyer_user_id: 'other-buyer', status: 'pending' }, { id: 'other-order', buyer_user_id: 'buyer-original', status: 'pending' }]) test(`resume missing/foreign order cannot reach provider: ${JSON.stringify(readSaved)}`, async () => {
  const f = resumeFixture({ readSaved }); assert.equal((await f.run({ order_id: resumeId })).status, 404); assert.equal(f.state.calls.length, 0);
});
for (const event of [null, { id: 'event-original', status: 'Cancelled' }, { id: 'event-original', status: 'Live', end_time: new Date(now - 1).toISOString() }]) test(`withdrawn, invisible or ended event cannot resume payment: ${JSON.stringify(event)}`, async () => {
  const f = resumeFixture({ event }); assert.equal((await f.run({ order_id: resumeId })).body.code, 'checkout_event_unavailable'); assert.equal(f.state.calls.length, 0); assert.equal(f.state.writes.length, 0);
});
for (const opts of [{ readError: true }, { eventError: true }, { hold: null }, { hold: { id: 'wrong' } }]) test(`uncertain recovery reads never create an order or session: ${JSON.stringify(opts)}`, async () => {
  const f = resumeFixture(opts); assert.equal((await f.run({ order_id: resumeId })).body.code, 'checkout_recovery_pending'); assert.equal(f.state.calls.length, 0); assert.equal(f.state.writes.length, 0);
});
test('resume with no known provider session does not invent a new payment for a historical order', async () => {
  const f = resumeFixture({ prior: false, minutes: 35 }); assert.equal((await f.run({ order_id: resumeId })).body.code, 'checkout_recovery_pending');
  assert.equal(f.state.calls.length, 0); assert.equal(f.state.writes.length, 0);
});
test('resume rejects malformed order IDs rather than falling through to new checkout', async () => {
  const f = fixture(); assert.equal((await f.run({ order_id: 'bad' })).status, 400); assert.equal(f.state.calls.length, 0); assert.equal(f.state.reads.length, 0);
});
test('original free pending order settles the saved hold without repeating changed questions', async () => {
  const f = resumeFixture({ prior: false, order: { is_free: true, face_cents: 0 } }); const r = await f.run({ order_id: resumeId });
  assert.equal(r.status, 200); assert.equal(r.body.free, true); assert.equal(calls(f, 'settle_ticket_hold').length, 1); assert.equal(calls(f, 'begin_ticket_checkout').length, 0);
});

for (const stripeKey of ['', 'invalid']) test(`unconfigured provider uses atomic free-only allocation: ${stripeKey}`, async () => {
  const f = fixture({stripeKey,order:{is_free:true,face_cents:0,total_cents:0,processing_cents:0,commission_cents:0,stripe_checkout_session_id:null}});
  const r = await f.run(); assert.equal(r.status,200); assert.equal(r.body.free,true);
  assert.equal(calls(f,'begin_free_ticket_checkout').length,1); assert.equal(calls(f,'begin_ticket_checkout').length,0);
  assert.equal(calls(f,'settle_ticket_hold').length,1); assert.equal(calls(f,'create').length,0);
});
test('unconfigured paid refusal does not dispatch settlement or provider actions', async () => {
  const f=fixture({stripeKey:'',beginError:{message:'ticketing payments are not configured yet.',code:'P0001'}});
  assert.equal((await f.run()).status,503);assert.equal(calls(f,'begin_free_ticket_checkout').length,1);
  assert.equal(calls(f,'settle_ticket_hold').length,0);assert.equal(f.state.writes.length,0);assert.equal(calls(f,'create').length,0);
});
test('missing paired free RPC never falls back to unrestricted allocation', async () => {
  const f=fixture({stripeKey:'',beginError:{code:'PGRST202',message:'private schema cache detail'}});
  const r=await f.run();assert.equal(r.status,503);assert.equal(JSON.stringify(r).includes('private'),false);
  assert.equal(calls(f,'begin_ticket_checkout').length,0);assert.equal(calls(f,'settle_ticket_hold').length,0);
});
for(const status of ['paid','canceled','refunded']) test(`owned ${status} receipt remains available without provider configuration`,async()=>{
  const id='1dba2600-0000-4000-8000-000000000001';const f=fixture({stripeKey:'',savedStatus:status,order:{order_id:id}});
  const r=await f.run({order_id:id});assert.equal(r.status,200);assert.equal(r.body.status,status);assert.equal(f.state.calls.length,0);
});
test('paid original-order resume without configuration preserves its order and session',async()=>{
  const id='1dba2600-0000-4000-8000-000000000001';const f=fixture({stripeKey:'',order:{order_id:id}});
  const r=await f.run({order_id:id});assert.equal(r.status,503);assert.equal(r.body.order_id,id);
  assert.equal(f.state.calls.length,0);assert.equal(f.state.writes.length,0);
});
test('owned free order settles without provider configuration or another allocation',async()=>{
  const id='1dba2600-0000-4000-8000-000000000001';const f=fixture({stripeKey:'',order:{order_id:id,is_free:true,face_cents:0,total_cents:0,stripe_checkout_session_id:null}});
  const r=await f.run({order_id:id});assert.equal(r.status,200);assert.equal(r.body.free,true);
  assert.deepEqual(f.state.calls.map(c=>c.name),['settle_ticket_hold']);
});

test('checkout preserves an extra option for transactional validation and keeps legacy payloads unchanged',async()=>{
 const f=fixture();await f.run({add_ons:[{add_on_id:'extra',qty:1,variation_id:'vegan'},{add_on_id:'parking',qty:1}]});
 assert.deepEqual(JSON.parse(JSON.stringify(calls(f,'begin_ticket_checkout')[0].args.p_add_ons)),[{add_on_id:'extra',qty:1,variation_id:'vegan'},{add_on_id:'parking',qty:1}]);
});
for(const variation_id of [null,42,{},'', ' '.repeat(4),'a'.repeat(129)])test('malformed option rejected before checkout: '+JSON.stringify(variation_id),async()=>{
 const f=fixture();assert.equal((await f.run({add_ons:[{add_on_id:'extra',qty:1,variation_id}]})).status,400);assert.equal(f.state.calls.length,0);
});
