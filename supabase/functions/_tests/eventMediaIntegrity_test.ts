import { createHash } from 'node:crypto';
import { EventMediaIntegrityError, verifyEventMediaReuseBytes } from '../_shared/eventMediaIntegrity.ts';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const makeInput = () => ({ supabaseUrl: 'http://127.0.0.1:55321', authorization: 'Bearer test', anonKey: 'anon',
  source: { objectName: `${a}/private-${b}.jpg`, byteSize: bytes.length, mimeType: 'image/jpeg' as const, contentDigest: sha(bytes) },
  destination: { objectName: `${b}/private-${a}.jpg`, byteSize: bytes.length, mimeType: 'image/jpeg' as const, contentDigest: sha(bytes) } });
const assert = (v: unknown, message = 'assertion failed') => { if (!v) throw Error(message); };
const response = (data = bytes, headers: HeadersInit = { 'content-type': 'image/jpeg' }, status = 200) => new Response(data, { status, headers });
const fail = async (fn: () => Promise<unknown>, code: string) => { try { await fn(); } catch (e) { assert(e instanceof EventMediaIntegrityError && e.code === code, String(e)); return; } throw Error('expected rejection'); };
Deno.test('raw SHA source and identical streamed destination produce an explicit raw-byte digest', async () => {
  const requests: RequestInit[] = []; const out = await verifyEventMediaReuseBytes(makeInput(), async (_, options) => { requests.push(options!); return response(); });
  assert(out.rawSha256 === sha(bytes) && out.sourceDigestKind === 'raw-sha256'); assert(requests.length === 2);
  assert(requests.every(r => r.redirect === 'error' && r.cache === 'no-store' && new Headers(r.headers).get('accept-encoding') === 'identity'));
});
Deno.test('native MD5 manifest is recognized explicitly while destination equality uses raw SHA256', async () => {
  const input = makeInput(), digest = sha(`washedup:event-media:native-md5:v1:image/jpeg:5:${createHash('md5').update(bytes).digest('hex')}`);
  input.source.contentDigest = input.destination.contentDigest = digest;
  const out = await verifyEventMediaReuseBytes(input, async () => response()); assert(out.sourceDigestKind === 'native-md5-manifest-v1' && out.rawSha256 === sha(bytes));
});
Deno.test('same-size same-MIME destination byte alteration is rejected', async () => {
  let calls = 0; await fail(() => verifyEventMediaReuseBytes(makeInput(), async () => response(++calls === 1 ? bytes : new Uint8Array([1, 2, 9, 4, 5]))), 'mismatch');
});
Deno.test('source fingerprint mismatch stops before any destination read', async () => {
  const input = makeInput(); input.source.contentDigest = input.destination.contentDigest = 'a'.repeat(64); let calls = 0;
  await fail(() => verifyEventMediaReuseBytes(input, async () => { calls++; return response(); }), 'fingerprint'); assert(calls === 1);
});
for (const [name, data] of [['short', bytes.slice(0, 4)], ['long', new Uint8Array(6)]] as const) Deno.test(`rejects ${name} body without trusting metadata`, async () => {
  await fail(() => verifyEventMediaReuseBytes(makeInput(), async () => response(data)), 'changed');
});
for (const status of [206, 302, 403, 500]) Deno.test(`rejects HTTP ${status}`, async () => {
  await fail(() => verifyEventMediaReuseBytes(makeInput(), async () => response(bytes, { 'content-type': 'image/jpeg' }, status)), 'unavailable');
});
for (const headers of [{ 'content-type': 'text/html' }, { 'content-type': 'image/jpeg', 'content-length': '4' }, { 'content-type': 'image/jpeg', 'content-length': '5x' }, { 'content-type': 'image/jpeg', 'content-encoding': 'gzip' }] as HeadersInit[]) Deno.test(`rejects changed transport headers ${JSON.stringify(headers)}`, async () => {
  await fail(() => verifyEventMediaReuseBytes(makeInput(), async () => response(bytes, headers)), 'changed');
});
Deno.test('arbitrary stream chunk boundaries do not affect the hash', async () => {
  const out = await verifyEventMediaReuseBytes(makeInput(), async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { 'content-type': 'image/jpeg' } })); assert(out.rawSha256 === sha(bytes));
});
Deno.test('snapshot prevents caller mutation changing destination after source fetch', async () => {
  const input = makeInput(); const paths: string[] = [];
  await verifyEventMediaReuseBytes(input, async url => { paths.push(String(url)); input.destination.objectName = 'unsafe'; input.authorization = 'changed'; return response(); }); assert(paths[1].endsWith(`${b}/private-${a}.jpg`));
});
for (const badPath of ['../other.jpg', `${a}/private-${b}.mp4`, `${a}/private-${b}.jpg?token=x`]) Deno.test(`rejects invalid descriptor ${badPath}`, async () => {
  const input = makeInput(); input.destination.objectName = badPath; let calls = 0; await fail(() => verifyEventMediaReuseBytes(input, async () => { calls++; return response(); }), 'invalid'); assert(calls === 0);
});
Deno.test('rejects same source/destination and inconsistent contracts', async () => {
  const input = makeInput(); input.destination.objectName = input.source.objectName; await fail(() => verifyEventMediaReuseBytes(input), 'invalid');
  input.destination.objectName = `${b}/private-${a}.jpg`; input.destination.byteSize = 4; await fail(() => verifyEventMediaReuseBytes(input), 'invalid');
});
Deno.test('rejects untrusted origin, credentials and unsupported deadlines before transport', async () => {
  for (const url of ['http://example.com', 'https://example.com/path', 'https://name:password@example.com', 'https://example.com/?token=x']) {
    const input = makeInput(); input.supabaseUrl = url; await fail(() => verifyEventMediaReuseBytes(input), 'invalid');
  }
  await fail(() => verifyEventMediaReuseBytes({ ...makeInput(), timeoutMs: 60001 }), 'invalid');
});
Deno.test('already aborted call makes no request', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0; await fail(() => verifyEventMediaReuseBytes({ ...makeInput(), signal: controller.signal }, async () => { calls++; return response(); }), 'interrupted'); assert(calls === 0);
});
Deno.test('deadline covers stalled response headers', async () => {
  await fail(() => verifyEventMediaReuseBytes({ ...makeInput(), timeoutMs: 10 }, () => new Promise(() => {})), 'interrupted');
});
Deno.test('deadline covers stalled body and cancels its reader', async () => {
  let cancelled = false; await fail(() => verifyEventMediaReuseBytes({ ...makeInput(), timeoutMs: 10 }, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/jpeg' } })), 'interrupted'); assert(cancelled);
});
Deno.test('external cancellation interrupts a body and cancels its reader', async () => {
  let cancelled = false; const controller = new AbortController(); const result = verifyEventMediaReuseBytes({ ...makeInput(), signal: controller.signal }, async () => new Response(new ReadableStream({ start() { queueMicrotask(() => controller.abort()); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/jpeg' } })); await fail(() => result, 'interrupted'); assert(cancelled);
});
Deno.test('late response after a header deadline is cancelled rather than retained', async () => {
  let resolve!: (value: Response) => void; let cancelled = false;
  await fail(() => verifyEventMediaReuseBytes({ ...makeInput(), timeoutMs: 10 }, () => new Promise(r => { resolve = r; })), 'interrupted');
  resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/jpeg' } }));
  await new Promise(r => setTimeout(r, 0)); assert(cancelled);
});
Deno.test('100 MiB video is hashed as bounded stream chunks without whole-body buffering', async () => {
  const chunk = new Uint8Array(65536).fill(7), chunks = 1600, raw = createHash('sha256');
  for (let i = 0; i < chunks; i++) raw.update(chunk);
  const digest = raw.digest('hex'), input = makeInput();
  const media = { byteSize: chunk.length * chunks, mimeType: 'video/mp4' as const, contentDigest: digest };
  let pulls = 0;
  const out = await verifyEventMediaReuseBytes({ ...input, source: { ...media, objectName: `${a}/private-${b}.mp4` }, destination: { ...media, objectName: `${b}/private-${a}.mp4` } }, async () => {
    let index = 0;
    return new Response(new ReadableStream({ pull(controller) { if (index++ < chunks) { pulls++; controller.enqueue(chunk); } else controller.close(); } }), { headers: { 'content-type': 'video/mp4', 'content-length': String(media.byteSize) } });
  });
  assert(out.byteSize === 104857600 && out.rawSha256 === digest && pulls === 3200);
});
