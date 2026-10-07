/** Actual endpoint boundary, closed adapters only. No SDK/provider/DB traffic.
 * Default: canonical relative sources after this test is copied into the repo.
 * Isolated review: pass the canonical repository's file:// URL after `--`.
 */
type Row = Record<string, any>;
type Operation = { kind: string; table?: string; name?: string; filters?: [string, unknown][] };
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
const equal = (actual: unknown, expected: unknown) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
const id = (value: number) => `22183000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const actor = id(1), otherActor = id(2), orderId = id(3), requestId = id(4);
const target = { order_id: orderId, client_request_id: requestId };
const root = Deno.args[0] ? new URL(Deno.args[0]) : new URL('../../../', import.meta.url);
const endpointUrl = new URL('supabase/functions/ticket-refund-status/index.ts', root);
const helperUrl = new URL('supabase/functions/_shared/refundRequestReceipt.ts', root);
const endpointSource = await Deno.readTextFile(endpointUrl);
const helperSource = await Deno.readTextFile(helperUrl);
const sha256 = async (source: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(value => value.toString(16).padStart(2, '0')).join('');
console.info(JSON.stringify({ actualEndpoint: endpointUrl.href, endpointSha256: await sha256(endpointSource), actualHelper: helperUrl.href, helperSha256: await sha256(helperSource) }));

const sdkImport = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';";
const helperImport = "import { readRefundRequestStatus, refundRequestIdIsValid } from '../_shared/refundRequestReceipt.ts';";
assert(endpointSource.split(sdkImport).length === 2, 'SDK boundary changed; review the closed loader');
assert(endpointSource.split(helperImport).length === 2, 'Helper boundary changed; review the closed loader');
assert(endpointSource.split('Deno.serve(').length === 2, 'Expected one actual handler registration');
let fixtureNumber = 0;

async function fixture() {
  const state = {
    userId: actor as string | null,
    authError: false,
    authThrows: false,
    readThrows: false,
    clients: [] as { url: string; key: string; options: any }[],
    authCalls: 0,
    operations: [] as Operation[],
    forbidden: [] as string[],
    envNames: [] as string[],
    rows: new Map<string, Row[]>([
      ['ticket_orders', [{ id: orderId, buyer_user_id: actor, event_id: id(5), explore_events: { host_user_id: id(6), community_id: null } }]],
      ['ticket_refund_requests', [{ request_id: requestId, order_id: orderId, requester_user_id: actor, state: 'complete', stripe_refund_id: 'fictional-refund', refund_amount_cents: 2400, positions_voided: 2 }]],
      ['communities', []], ['ticket_refunds', []], ['ticket_order_positions', []],
    ]),
  };
  const forbidden = (operation: string): never => { state.forbidden.push(operation); throw new Error(`Closed fixture forbids ${operation}`); };
  const guard = <T extends object>(value: T, label: string): T => new Proxy(value, {
    get(object, name, receiver) {
      if (Reflect.has(object, name)) return Reflect.get(object, name, receiver);
      return forbidden(`${label}.${String(name)}`);
    },
  });
  const service = guard({
    from(table: string) {
      if (!state.rows.has(table)) return forbidden(`table:${table}`);
      const filters: [string, unknown][] = [];
      const notNull: string[] = [];
      let head = false;
      let query: any;
      const finish = async () => {
        state.operations.push({ kind: 'select', table, filters: [...filters] });
        if (state.readThrows) throw new Error('private fixture read detail');
        const selected = state.rows.get(table)!.filter(row => filters.every(([key, value]) => row[key] === value) && notNull.every(key => row[key] != null));
        return head ? { count: selected.length, error: null } : { data: selected[0] ?? null, error: null };
      };
      query = guard({
        select(_columns: string, options: { head?: boolean } = {}) { head = options.head === true; return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        not(column: string, operator: string, value: unknown) { assert(operator === 'is' && value === null); notNull.push(column); return query; },
        maybeSingle: finish,
        then(yes: (value: unknown) => unknown, no: (reason: unknown) => unknown) { return finish().then(yes, no); },
      }, `query:${table}`);
      return query;
    },
    async rpc(name: string, args: Row) {
      if (name !== 'has_refund_authority') return forbidden(`rpc:${name}`);
      state.operations.push({ kind: 'authority-read', name });
      assert(args.p_user_id === state.userId && args.p_event_id === id(5));
      return { data: false, error: null };
    },
  }, 'service');
  const userClient = guard({ auth: guard({ async getUser() {
    state.authCalls++;
    if (state.authThrows) throw new Error('private fixture auth detail');
    return { data: { user: state.userId ? { id: state.userId } : null }, error: state.authError ? new Error('private invalid JWT') : null };
  } }, 'auth') }, 'caller');
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const registry = globalThis as typeof globalThis & { __refundStatusEndpointFixture?: unknown };
  registry.__refundStatusEndpointFixture = {
    createClient(url: string, key: string, options: Row) {
      state.clients.push({ url, key, options });
      assert(url === 'http://127.0.0.1:0', 'Only the synthetic endpoint is permitted');
      if (key === 'fixture-anon') return userClient;
      if (key === 'fixture-service') return service;
      return forbidden('unexpected SDK client');
    },
    Deno: {
      env: { get(name: string) {
        state.envNames.push(name);
        const values: Record<string, string> = { SUPABASE_URL: 'http://127.0.0.1:0', SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' };
        if (!(name in values)) return forbidden(`environment:${name}`);
        return values[name];
      } },
      serve(callback: typeof handler) { assert(!handler); handler = callback; },
    },
  };
  const adapted = endpointSource.replace(sdkImport, [
    'const deps = (globalThis as any).__refundStatusEndpointFixture;',
    'const createClient: (...args: any[]) => any = deps.createClient;',
    'const Deno: { serve(handler: (request: Request) => Promise<Response>): void; env: { get(name: string): string } } = deps.Deno;',
  ].join('\n')).replace(helperImport, `import { readRefundRequestStatus, refundRequestIdIsValid } from ${JSON.stringify(helperUrl.href)};`);
  assert(!adapted.includes('https://') && !adapted.includes('npm:'), 'An external import escaped the closed loader');
  try { await import(`data:application/typescript,${encodeURIComponent(adapted + `\n// closed fixture ${++fixtureNumber}`)}`); }
  finally { delete registry.__refundStatusEndpointFixture; }
  assert(handler, 'The actual source did not register its handler');
  return {
    state,
    async run(request: Request) {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() => forbidden('fetch')) as typeof fetch;
      try { return await handler!(request); }
      finally {
        globalThis.fetch = originalFetch;
        equal(state.forbidden, []);
        assert(state.operations.every(operation => operation.kind === 'select' || operation.kind === 'authority-read'), 'Unexpected write/provider operation');
      }
    },
  };
}

const request = (body: unknown = target, authorization: string | null = 'Bearer fixture-token', method = 'POST') => new Request('http://closed.invalid/ticket-refund-status', {
  method, headers: { ...(authorization === null ? {} : { Authorization: authorization }), 'Content-Type': 'application/json' },
  ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});

Deno.test('actual status endpoint: OPTIONS and unsupported methods do no auth or backend work', async () => {
  const f = await fixture();
  equal((await f.run(request(target, null, 'OPTIONS'))).status, 200);
  for (const method of ['GET', 'PUT', 'DELETE']) equal((await f.run(request(target, null, method))).status, 405);
  equal(f.state.clients.length, 0); equal(f.state.envNames, []); equal(f.state.operations, []);
});

Deno.test('actual status endpoint: missing or non-Bearer authorization stops before SDK creation', async () => {
  const f = await fixture();
  for (const authorization of [null, '', 'Basic fixture-token']) equal((await f.run(request(target, authorization))).status, 401);
  equal(f.state.clients.length, 0); equal(f.state.operations, []);
});

Deno.test('actual status endpoint: invalid JSON and invalid UUID body cannot reach auth', async () => {
  const f = await fixture();
  equal((await f.run(new Request('http://closed.invalid/ticket-refund-status', { method: 'POST', headers: { Authorization: 'Bearer fixture-token' }, body: '{broken' }))).status, 400);
  for (const body of [null, {}, [], { ...target, order_id: 'order' }, { ...target, client_request_id: 'request' }, { ...target, order_id: 3 }, { order_id: orderId }]) {
    equal((await f.run(request(body))).status, 400);
  }
  equal(f.state.authCalls, 0); equal(f.state.clients.length, 0); equal(f.state.operations, []);
});

Deno.test('actual status endpoint: Bearer presence cannot substitute for verified getUser', async () => {
  for (const authError of [false, true]) {
    const f = await fixture(); f.state.userId = authError ? actor : null; f.state.authError = authError;
    const response = await f.run(request()); equal(response.status, 401);
    equal(await response.json(), { error: 'unauthenticated' });
    equal(f.state.authCalls, 1); equal(f.state.clients.length, 1); equal(f.state.operations, []);
  }
});

Deno.test('actual status endpoint: verified actor overrides body identity and returns exact receipt identity', async () => {
  const f = await fixture();
  const response = await f.run(request({ ...target, requester_user_id: otherActor, user_id: otherActor, action: 'refund' }));
  equal(response.status, 200);
  equal(await response.json(), { ok: true, order_id: orderId, client_request_id: requestId, requester_user_id: actor, state: 'complete', refund_amount_cents: 2400, positions_voided: 2 });
  equal(f.state.clients.length, 2); equal(f.state.authCalls, 1);
  equal(f.state.clients[0].options.global.headers.Authorization, 'Bearer fixture-token');
  equal(f.state.clients[1].options, { auth: { persistSession: false } });
  const journalRead = f.state.operations.find(operation => operation.table === 'ticket_refund_requests');
  equal(journalRead?.filters, [['request_id', requestId], ['order_id', orderId], ['requester_user_id', actor]]);
});

Deno.test('actual status endpoint: unauthorized verified actor cannot borrow body requester identity', async () => {
  const f = await fixture(); f.state.userId = otherActor;
  const response = await f.run(request({ ...target, requester_user_id: actor }));
  equal(response.status, 403); equal(await response.json(), { error: 'refund status unavailable for this account' });
  assert(!f.state.operations.some(operation => operation.table === 'ticket_refund_requests'), 'Unauthorized actor reached private journal');
});

Deno.test('actual status endpoint: missing exact request remains unknown without executing or creating one', async () => {
  const f = await fixture();
  const missingId = id(9), response = await f.run(request({ ...target, client_request_id: missingId }));
  equal(response.status, 200);
  equal(await response.json(), { ok: true, order_id: orderId, client_request_id: missingId, requester_user_id: actor, state: 'unknown' });
  equal(f.state.rows.get('ticket_refund_requests')!.length, 1);
  assert(f.state.operations.every(operation => operation.kind === 'select'));
});

Deno.test('actual status endpoint: auth/read exceptions stay unavailable and never expose private detail', async () => {
  for (const stage of ['auth', 'read']) {
    const f = await fixture(); f.state.authThrows = stage === 'auth'; f.state.readThrows = stage === 'read';
    const response = await f.run(request()); equal(response.status, 503);
    equal(await response.json(), { error: 'refund status could not be checked' });
    if (stage === 'auth') equal(f.state.clients.length, 1);
  }
});
