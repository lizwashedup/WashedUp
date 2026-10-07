/** Server-side byte verification for an already-authorized upload or reuse attempt.
 * Resolve descriptors through backend authority checks before calling. The
 * returned value is not a client credential: a service-only database boundary
 * must bind it to the exact immutable Storage objects before completion.
 */
import { createHash } from 'node:crypto';

export interface IntegrityMediaDescriptor {
  objectName: string;
  byteSize: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
  contentDigest: string;
}
export type SourceDigestKind = 'raw-sha256' | 'native-md5-manifest-v1';
export class EventMediaIntegrityError extends Error {
  constructor(readonly code: 'invalid' | 'unavailable' | 'changed' | 'fingerprint' | 'mismatch' | 'interrupted') {
    super(`Media integrity could not be confirmed (${code}).`);
  }
}
const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const pathPattern = new RegExp(`^${uuid}/private-${uuid}\\.(jpg|png|webp|mp4)$`);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
function descriptor(input: IntegrityMediaDescriptor): IntegrityMediaDescriptor {
  const match = typeof input?.objectName === 'string' && pathPattern.exec(input.objectName);
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' }[input?.mimeType];
  if (!match || match[1] !== ext || !Number.isSafeInteger(input.byteSize) || input.byteSize < 1
    || input.byteSize > (input.mimeType === 'video/mp4' ? 104857600 : 10485760)
    || !/^[0-9a-f]{64}$/.test(input.contentDigest)) throw new EventMediaIntegrityError('invalid');
  return { objectName: input.objectName, byteSize: input.byteSize, mimeType: input.mimeType, contentDigest: input.contentDigest };
}
function origin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
    || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new EventMediaIntegrityError('invalid');
  }
  return url.origin;
}

interface IntegrityRequest {
  supabaseUrl: string;
  authorization: string;
  anonKey: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export function verifyEventMediaReuseBytes(input: IntegrityRequest & {
  source: IntegrityMediaDescriptor; destination: IntegrityMediaDescriptor;
}, fetcher: typeof fetch = fetch) {
  return verifyMediaBytes(input, 'reuse', fetcher);
}
export function verifyEventMediaUploadBytes(input: IntegrityRequest & {
  media: IntegrityMediaDescriptor;
}, fetcher: typeof fetch = fetch) {
  return verifyMediaBytes({ supabaseUrl: input.supabaseUrl, authorization: input.authorization,
    anonKey: input.anonKey, signal: input.signal, timeoutMs: input.timeoutMs, source: input.media }, 'upload', fetcher);
}
async function verifyMediaBytes(input: IntegrityRequest & {
  source: IntegrityMediaDescriptor; destination?: IntegrityMediaDescriptor;
}, mode: 'upload' | 'reuse', fetcher: typeof fetch): Promise<{ byteSize: number; mimeType: string; rawSha256: string; sourceDigestKind: SourceDigestKind }> {
  // Capture exact intent and headers before any asynchronous boundary.
  const source = descriptor(input.source), destination = input.destination === undefined ? null : descriptor(input.destination), base = origin(input.supabaseUrl);
  const timeoutMs = input.timeoutMs ?? 60000;
  if (mode === 'reuse' && !destination || destination && (source.objectName === destination.objectName || source.byteSize !== destination.byteSize
    || source.mimeType !== destination.mimeType || source.contentDigest !== destination.contentDigest)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !/^Bearer \S+$/.test(input.authorization) || !input.anonKey || /[\r\n]/.test(input.anonKey)) throw new EventMediaIntegrityError('invalid');
  const headers = { Authorization: input.authorization, apikey: input.anonKey, 'Cache-Control': 'no-store', 'Accept-Encoding': 'identity' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener('abort', abort, { once: true });
  if (input.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  const current = () => { if (controller.signal.aborted) throw new EventMediaIntegrityError('interrupted'); };
  // The deadline covers both response headers and every byte read, including
  // a transport that does not settle promptly after signal cancellation.
  async function bounded<T>(action: () => Promise<T>): Promise<T> {
    current();
    let onAbort = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new EventMediaIntegrityError('interrupted'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    try { const value = await Promise.race([action(), interrupted]); current(); return value; }
    finally { controller.signal.removeEventListener('abort', onAbort); }
  }
  async function hash(media: IntegrityMediaDescriptor) {
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      response = await bounded(async () => {
        const loaded = await fetcher(`${base}/storage/v1/object/authenticated/creator-event-media/${media.objectName}`,
          { method: 'GET', headers, redirect: 'error', cache: 'no-store', signal: controller.signal });
        response = loaded;
        if (controller.signal.aborted) {
          void loaded.body?.cancel().catch(() => {});
          throw new EventMediaIntegrityError('interrupted');
        }
        return loaded;
      });
      const length = response.headers.get('content-length');
      if (response.status !== 200 || response.redirected || !response.body) throw new EventMediaIntegrityError('unavailable');
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== media.mimeType
        || ![null, 'identity'].includes(response.headers.get('content-encoding'))
        || length !== null && (!/^\d+$/.test(length) || Number(length) !== media.byteSize)) throw new EventMediaIntegrityError('changed');
      reader = response.body.getReader();
      const raw = createHash('sha256'), md5 = createHash('md5');
      let bytes = 0;
      while (true) {
        const chunk = await bounded(() => reader!.read());
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > media.byteSize) throw new EventMediaIntegrityError('changed');
        raw.update(chunk.value); md5.update(chunk.value);
      }
      if (bytes !== media.byteSize) throw new EventMediaIntegrityError('changed');
      return { rawSha256: raw.digest('hex'), fileMd5: md5.digest('hex') };
    } catch (error) {
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
      if (error instanceof EventMediaIntegrityError) throw error;
      throw new EventMediaIntegrityError('unavailable');
    } finally {
      try { reader?.releaseLock(); } catch { /* A cancelled native read can still be settling. */ }
    }
  }
  try {
    const original = await hash(source);
    const kind: SourceDigestKind | null = source.contentDigest === original.rawSha256 ? 'raw-sha256'
      : source.contentDigest === sha256(`washedup:event-media:native-md5:v1:${source.mimeType}:${source.byteSize}:${original.fileMd5}`)
      ? 'native-md5-manifest-v1' : null;
    if (!kind) throw new EventMediaIntegrityError('fingerprint');
    if (destination) {
      const copy = await hash(destination);
      if (copy.rawSha256 !== original.rawSha256) throw new EventMediaIntegrityError('mismatch');
    }
    current();
    return { byteSize: source.byteSize, mimeType: source.mimeType, rawSha256: original.rawSha256, sourceDigestKind: kind };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}
