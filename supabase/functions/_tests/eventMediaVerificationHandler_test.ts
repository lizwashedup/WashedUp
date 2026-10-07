import { createHash } from 'node:crypto';
import { createEventMediaVerificationHandler, type MediaVerificationDependencies } from '../_shared/eventMediaVerificationHandler.ts';
import { EventMediaIntegrityError, verifyEventMediaReuseBytes } from '../_shared/eventMediaIntegrity.ts';
const id = (v: number) => `0fe70000-0000-4000-8000-${String(v).padStart(12, '0')}`;
const target = { pageId: id(1), eventId: id(2), mediaId: id(3) }, actor = id(9), bytes = new Uint8Array([1, 2, 3, 4, 5]), digest = createHash('sha256').update(bytes).digest('hex');
const object = (p: number, e: number, m: number, o: number) => ({ page_id: id(p), event_id: id(e), media_id: id(m), object_id: id(o), object_version: 'v1', object_updated_at: '2026-09-15T00:00:00Z', object_name: `${id(e)}/private-${id(m)}.jpg`, byte_size: 5, mime_type: 'image/jpeg', content_digest: digest });
const receipt = () => ({ id: target.mediaId, page_id: target.pageId, event_id: target.eventId, created_by: actor, abandoned_at: null, ready_at: null as string | null, object_present: true });
const binding = () => ({ version: 1, user_id: actor, source: object(4, 5, 6, 7), destination: object(1, 2, 3, 8) });
const assert = (value: unknown, message = 'assertion failed') => { if (!value) throw Error(message); };
const request = (body: unknown = target, headers: Record<string, string> = {}, method = 'POST') => new Request('http://localhost/verify', { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), headers: { authorization: 'Bearer user-token', 'content-type': 'application/json', ...headers } });
function fixture() {
  const state = { actor: actor as string | null, initial: receipt() as unknown, target: binding() as unknown, second: undefined as unknown, authError: false, rpcError: null as { code: string } | null, recordError: false, byteFailure: false, byteCalls: 0, clientCalls: 0, serviceCalls: 0, reads: 0, calls: [] as Array<{ name: string; args: Record<string, unknown>; role: string }> };
  const deps: MediaVerificationDependencies = { supabaseUrl: 'http://127.0.0.1:55321', anonKey: 'anon',
    userClient: (authorization, signal) => { state.clientCalls++; assert(authorization === 'Bearer user-token' && signal instanceof AbortSignal); return {
      auth: { getUser: async token => { assert(token === 'user-token'); return { data: { user: state.actor ? { id: state.actor } : null }, error: state.authError ? Error('private detail') : null }; } },
      rpc: async (name, args) => { state.calls.push({ name, args, role: 'user' }); if (state.rpcError) return { data: null, error: state.rpcError };
        const data = name === 'get_creator_page_event_media_attempt' ? state.initial : name === 'get_creator_page_event_media_verification' ? (++state.reads === 2 && state.second !== undefined ? state.second : state.target) : { ...receipt(), ready_at: '2026-09-15T01:00:00Z' }; return { data, error: null }; },
    }; },
    verifierClient: signal => { state.serviceCalls++; assert(signal instanceof AbortSignal); return { rpc: async (name, args) => { state.calls.push({ name, args, role: 'service' }); if (state.recordError) throw Error('lost private record response'); return { data: { media_id: target.mediaId, verified_at: '2026-09-15T01:00:00Z' }, error: null }; } }; },
    verifyBytes: async input => { state.byteCalls++; assert(input.authorization === 'Bearer user-token' && input.source.objectName === binding().source.object_name); if (state.byteFailure) throw new EventMediaIntegrityError('mismatch'); return { byteSize: 5, mimeType: 'image/jpeg', rawSha256: digest, sourceDigestKind: 'raw-sha256' }; },
  };
  return { state, deps, run: (r = request()) => createEventMediaVerificationHandler(deps)(r) };
}
Deno.test('authorized handler resolves bytes, refreshes binding, records only as service, then completes as caller', async () => {
  const f = fixture(), response = await f.run(); assert(response.status === 200); assert(response.headers.get('cache-control') === 'private, no-store');
  assert(f.state.calls.map(c => c.name).join(',') === 'get_creator_page_event_media_attempt,get_creator_page_event_media_verification,get_creator_page_event_media_verification,record_creator_page_event_media_verification,complete_creator_page_event_media');
  const proof = f.state.calls[3]; assert(proof.role === 'service' && proof.args.p_raw_sha256 === digest && f.state.calls[4].role === 'user');
});
Deno.test('confirmed original receipt skips source reauthorization and byte/proof work', async () => {
  const f = fixture(); f.state.initial = { ...receipt(), ready_at: '2026-09-15T01:00:00Z' }; assert((await f.run()).status === 200); assert(f.state.byteCalls === 0 && f.state.serviceCalls === 0 && f.state.calls.length === 2);
});
for (const method of ['GET', 'PUT', 'DELETE']) Deno.test(`rejects ${method} before authorization work`, async () => {
  const f = fixture(); assert((await f.run(request(undefined, {}, method))).status === 405 && f.state.clientCalls === 0);
});
Deno.test('OPTIONS response has no auth/backend work', async () => { const f = fixture(); assert((await f.run(request(undefined, {}, 'OPTIONS'))).status === 200 && f.state.clientCalls === 0); });
Deno.test('missing bearer token cannot reach backend or verifier', async () => { const f = fixture(); assert((await f.run(request(target, { authorization: '' }))).status === 401 && f.state.clientCalls === 0); });
for (const body of [null, {}, { ...target, userId: actor }, { ...target, sourceUrl: 'http://example.invalid' }, { ...target, rawSha256: digest }, { ...target, mediaId: '../file' }]) Deno.test(`rejects caller-supplied authority or invalid target ${JSON.stringify(body)}`, async () => {
  const f = fixture(); assert((await f.run(request(body))).status === 400 && f.state.clientCalls === 0);
});
Deno.test('oversized body is bounded before auth work', async () => { const f = fixture(); assert((await f.run(request('x'.repeat(5000)))).status === 413 && f.state.clientCalls === 0); });
Deno.test('wrong content type is rejected before auth work', async () => { const f = fixture(); assert((await f.run(request(target, { 'content-type': 'text/plain' }))).status === 400); });
Deno.test('auth failure does not reveal underlying error or reach RPC', async () => { const f = fixture(); f.state.authError = true; const response = await f.run(); assert(response.status === 401 && f.state.calls.length === 0 && !(await response.text()).includes('private')); });
Deno.test('missing reservation returns unavailable without creating one', async () => { const f = fixture(); f.state.initial = null; assert((await f.run()).status === 404 && f.state.calls.length === 1); });
for (const patch of [{ created_by: id(10) }, { id: id(10) }, { abandoned_at: '2026-09-15T01:00:00Z' }]) Deno.test(`wrong or abandoned original receipt cannot reach verifier ${JSON.stringify(patch)}`, async () => {
  const f = fixture(); f.state.initial = { ...receipt(), ...patch }; assert((await f.run()).status === 409 && f.state.serviceCalls === 0);
});
Deno.test('byte mismatch never creates a service client or completes', async () => { const f = fixture(); f.state.byteFailure = true; assert((await f.run()).status === 409 && f.state.serviceCalls === 0 && f.state.calls.length === 2); });
Deno.test('changed authoritative binding after bytes prevents proof', async () => { const f = fixture(); f.state.second = { ...binding(), destination: { ...binding().destination, object_version: 'v2' } }; assert((await f.run()).status === 409 && f.state.serviceCalls === 0); });
Deno.test('equivalent reordered binding does not cause a false conflict', async () => { const f = fixture(), original = binding(); f.state.second = { destination: original.destination, source: original.source, user_id: actor, version: 1 }; assert((await f.run()).status === 200); });
for (const code of ['42501', 'PT409', 'XX000']) Deno.test(`backend ${code} is mapped without alternate writes`, async () => { const f = fixture(); f.state.rpcError = { code }; assert((await f.run()).status === (code === '42501' ? 403 : code === 'PT409' ? 409 : 503) && f.state.serviceCalls === 0); });
Deno.test('lost proof response remains unknown and never dispatches completion', async () => { const f = fixture(); f.state.recordError = true; const response = await f.run(); assert(response.status === 503 && f.state.calls.filter(c => c.role === 'service').length === 1 && !f.state.calls.some(c => c.name === 'complete_creator_page_event_media')); assert(!(await response.text()).includes('private record')); });
Deno.test('wrong binding actor or file identity fails before verification', async () => { const f = fixture(); f.state.target = { ...binding(), user_id: id(10) }; assert((await f.run()).status === 503 && f.state.byteCalls === 0); });
Deno.test('stalled auth is bounded by handler deadline', async () => { const f = fixture(); f.deps.timeoutMs = 10; f.deps.userClient = () => ({ auth: { getUser: () => new Promise(() => {}) }, rpc: async () => ({ data: null, error: null }) }); assert((await f.run()).status === 504); });
Deno.test('stalled body is cancelled at handler deadline', async () => { const f = fixture(); f.deps.timeoutMs = 10; let cancelled = false; const req = new Request('http://localhost/verify', { method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' }, body: new ReadableStream({ cancel() { cancelled = true; } }) }); assert((await f.run(req)).status === 504 && cancelled && f.state.clientCalls === 0); });
for (const changed of [false, true]) Deno.test(`actual streamed byte helper within handler; altered=${changed}`, async () => {
  const f = fixture(); let reads = 0; f.deps.verifyBytes = input => verifyEventMediaReuseBytes(input, async () => { const data = new Uint8Array(bytes); if (++reads === 2 && changed) data[2] = 9; return new Response(data, { headers: { 'content-type': 'image/jpeg' } }); });
  assert((await f.run()).status === (changed ? 409 : 200)); assert(f.state.serviceCalls === (changed ? 0 : 1));
});

function uploadFixture() {
  const f = fixture(); f.state.target = { version: 2, kind: 'upload', user_id: actor, destination: binding().destination };
  f.deps.verifyUploadBytes = async input => { f.state.byteCalls++; assert(input.media.objectName === binding().destination.object_name && input.authorization === 'Bearer user-token');
    if (f.state.byteFailure) throw new EventMediaIntegrityError('fingerprint');
    return { byteSize: 5, mimeType: 'image/jpeg', rawSha256: digest, sourceDigestKind: 'raw-sha256' };
  };
  return f;
}
Deno.test('original upload uses authoritative upload binding and same service proof/completion path', async () => {
  const f = uploadFixture(); assert((await f.run()).status === 200 && f.state.byteCalls === 1 && f.state.serviceCalls === 1);
  assert(f.state.calls[3].role === 'service' && f.state.calls[3].args.p_raw_sha256 === digest && f.state.calls[4].role === 'user');
});
Deno.test('original upload fingerprint failure never records proof or completes', async () => {
  const f = uploadFixture(); f.state.byteFailure = true; assert((await f.run()).status === 409 && f.state.serviceCalls === 0 && f.state.calls.length === 2);
});
Deno.test('original upload version change after bytes is rejected before proof', async () => {
  const f = uploadFixture(); f.state.second = { version: 2, kind: 'upload', user_id: actor, destination: { ...binding().destination, object_version: 'changed' } };
  assert((await f.run()).status === 409 && f.state.serviceCalls === 0);
});
for (const malformed of [
  { ...binding(), version: 2, kind: 'upload' },
  { version: 2, kind: 'reuse', user_id: actor, destination: binding().destination },
  { version: 3, kind: 'upload', user_id: actor, destination: binding().destination },
  { ...binding(), kind: 'upload' },
]) Deno.test(`ambiguous authoritative attempt kind is rejected: ${JSON.stringify(malformed)}`, async () => {
  const f = uploadFixture(); f.state.target = malformed; assert((await f.run()).status === 503 && f.state.byteCalls === 0 && f.state.serviceCalls === 0);
});
Deno.test('caller cannot choose upload mode to bypass reuse comparison', async () => {
  const f = fixture(); assert((await f.run(request({ ...target, kind: 'upload' }))).status === 400 && f.state.clientCalls === 0);
});
Deno.test('original lost proof response preserves unknown state without completing', async () => {
  const f = uploadFixture(); f.state.recordError = true; assert((await f.run()).status === 503 && !f.state.calls.some(c => c.name === 'complete_creator_page_event_media'));
});
