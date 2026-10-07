import { createHash } from 'node:crypto';
import { EventMediaIntegrityError, verifyEventMediaUploadBytes } from '../_shared/eventMediaIntegrity.ts';

const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const hash = (kind: string, value: string | Uint8Array) => createHash(kind).update(value).digest('hex');
const input = () => ({ supabaseUrl: 'http://127.0.0.1:55321', authorization: 'Bearer test', anonKey: 'anon',
  media: { objectName: `${a}/private-${b}.jpg`, byteSize: bytes.length, mimeType: 'image/jpeg' as const, contentDigest: hash('sha256', bytes) } });
const assert = (value: unknown) => { if (!value) throw Error('assertion failed'); };
const response = (data = bytes, mime = 'image/jpeg') => new Response(data, { headers: { 'content-type': mime } });
async function fail(action: () => Promise<unknown>, code: string) {
  try { await action(); } catch (e) { assert(e instanceof EventMediaIntegrityError && e.code === code); return; }
  throw Error('Expected integrity rejection');
}

Deno.test('original upload verifies its actual raw SHA256 with one authorized private-object read', async () => {
  let calls = 0;
  const result = await verifyEventMediaUploadBytes(input(), async (url, options) => {
    calls++; assert(String(url).endsWith(`/storage/v1/object/authenticated/creator-event-media/${a}/private-${b}.jpg`));
    assert(new Headers(options?.headers).get('authorization') === 'Bearer test');
    assert(options?.redirect === 'error' && options.cache === 'no-store'); return response();
  });
  assert(calls === 1 && result.rawSha256 === hash('sha256', bytes) && result.sourceDigestKind === 'raw-sha256');
});
Deno.test('original native manifest retains explicit compatibility kind and returns computed raw hash', async () => {
  const value = input(); value.media.contentDigest = hash('sha256', `washedup:event-media:native-md5:v1:image/jpeg:5:${hash('md5', bytes)}`);
  const result = await verifyEventMediaUploadBytes(value, async () => response());
  assert(result.sourceDigestKind === 'native-md5-manifest-v1' && result.rawSha256 === hash('sha256', bytes));
});
Deno.test('original upload rejects the observed same-size altered-byte bypass', async () => {
  await fail(() => verifyEventMediaUploadBytes(input(), async () => response(new Uint8Array([1, 2, 9, 4, 5]))), 'fingerprint');
});
Deno.test('original upload rejects changed MIME and short bytes', async () => {
  await fail(() => verifyEventMediaUploadBytes(input(), async () => response(bytes, 'text/plain')), 'changed');
  await fail(() => verifyEventMediaUploadBytes(input(), async () => response(bytes.slice(1))), 'changed');
});
Deno.test('original upload captures descriptor and auth before transport can mutate the caller', async () => {
  const value = input();
  const result = await verifyEventMediaUploadBytes(value, async (_, options) => {
    value.media.contentDigest = '0'.repeat(64); value.media.byteSize = 900; value.authorization = 'changed';
    assert(new Headers(options?.headers).get('authorization') === 'Bearer test'); return response();
  });
  assert(result.byteSize === bytes.length && result.rawSha256 === hash('sha256', bytes));
});
Deno.test('original upload refuses unsafe object paths before downloading', async () => {
  const value = input(); value.media.objectName = '../other.jpg'; let calls = 0;
  await fail(() => verifyEventMediaUploadBytes(value, async () => { calls++; return response(); }), 'invalid'); assert(calls === 0);
});
Deno.test('original upload deadline releases a stalled body', async () => {
  let cancelled = false;
  await fail(() => verifyEventMediaUploadBytes({ ...input(), timeoutMs: 10 }, async () => new Response(
    new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/jpeg' } })), 'interrupted');
  assert(cancelled);
});
Deno.test('original upload cancellation makes no request', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await fail(() => verifyEventMediaUploadBytes({ ...input(), signal: controller.signal }, async () => { calls++; return response(); }), 'interrupted'); assert(calls === 0);
});
