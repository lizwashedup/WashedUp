import { corsHeaders } from './cors.ts';
import { EventMediaIntegrityError, verifyEventMediaReuseBytes, verifyEventMediaUploadBytes, type IntegrityMediaDescriptor } from './eventMediaIntegrity.ts';
interface RpcResult { data: unknown; error: { code?: string } | null }
export interface MediaVerifierClient {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}
export interface MediaVerificationDependencies {
  supabaseUrl: string; anonKey: string;
  userClient(authorization: string, signal: AbortSignal): MediaVerifierClient;
  verifierClient(signal: AbortSignal): Pick<MediaVerifierClient, 'rpc'>;
  verifyBytes?: typeof verifyEventMediaReuseBytes;
  verifyUploadBytes?: typeof verifyEventMediaUploadBytes;
  timeoutMs?: number;
}
class HandlerFailure extends Error { constructor(readonly status: number) { super('Media verification unavailable'); } }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : record(v)
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
function media(v: unknown): IntegrityMediaDescriptor {
  if (!record(v) || !uuid(v.media_id) || !uuid(v.event_id) || !uuid(v.page_id) || !uuid(v.object_id)
    || typeof v.object_version !== 'string' || !v.object_version || typeof v.object_updated_at !== 'string'
    || !Number.isFinite(Date.parse(v.object_updated_at)) || typeof v.object_name !== 'string'
    || !v.object_name.startsWith(`${v.event_id}/private-${v.media_id}.`) || typeof v.byte_size !== 'number'
    || typeof v.mime_type !== 'string' || typeof v.content_digest !== 'string') throw new HandlerFailure(503);
  return { objectName: v.object_name, byteSize: v.byte_size, mimeType: v.mime_type as IntegrityMediaDescriptor['mimeType'], contentDigest: v.content_digest };
}
export function createEventMediaVerificationHandler(deps: MediaVerificationDependencies) {
  const timeoutMs = deps.timeoutMs ?? 50000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 50000) throw Error('Invalid verifier deadline');
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return json({});
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const authorization = request.headers.get('authorization') ?? '';
    if (!/^Bearer \S+$/.test(authorization)) return json({ error: 'sign in required' }, 401);
    const controller = new AbortController(), abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    const current = () => { if (controller.signal.aborted) throw new HandlerFailure(504); };
    async function bounded<T>(action: () => PromiseLike<T>): Promise<T> {
      current(); let onAbort = () => {};
      const interrupted = new Promise<never>((_, reject) => { onAbort = () => reject(new HandlerFailure(504)); controller.signal.addEventListener('abort', onAbort, { once: true }); });
      try { const value = await Promise.race([action(), interrupted]); current(); return value; }
      finally { controller.signal.removeEventListener('abort', onAbort); }
    }
    const call = async (client: Pick<MediaVerifierClient, 'rpc'>, name: string, args: Record<string, unknown>) => {
      const result = await bounded(() => client.rpc(name, args));
      if (result.error) throw new HandlerFailure(result.error.code === '42501' ? 403 : ['PT409', '22023'].includes(result.error.code ?? '') ? 409 : 503);
      return result.data;
    };
    try {
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HandlerFailure(400);
      const reader = request.body?.getReader(); if (!reader) throw new HandlerFailure(400);
      let text = '', length = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        while (true) { const part = await bounded(() => reader.read()); if (part.done) break; length += part.value.byteLength;
          if (length > 4096) throw new HandlerFailure(413); text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode();
      } catch (e) { void reader.cancel().catch(() => {}); if (e instanceof HandlerFailure) throw e; throw new HandlerFailure(400); }
      finally { try { reader.releaseLock(); } catch { /* Cancelled read may still settle. */ } }
      let body: unknown; try { body = JSON.parse(text); } catch { throw new HandlerFailure(400); }
      if (!record(body) || Object.keys(body).sort().join(',') !== 'eventId,mediaId,pageId' || !uuid(body.pageId) || !uuid(body.eventId) || !uuid(body.mediaId)) throw new HandlerFailure(400);
      const client = deps.userClient(authorization, controller.signal);
      const identity = await bounded(() => client.auth.getUser(authorization.slice(7)));
      if (identity.error || !uuid(identity.data.user?.id)) throw new HandlerFailure(401);
      const actor = identity.data.user!.id;
      const args = { p_page_id: body.pageId, p_event_id: body.eventId, p_media_id: body.mediaId };
      const original = await call(client, 'get_creator_page_event_media_attempt', args);
      if (!record(original)) throw new HandlerFailure(404);
      if (original.id !== body.mediaId || original.page_id !== body.pageId || original.event_id !== body.eventId || original.created_by !== actor || original.abandoned_at !== null) throw new HandlerFailure(409);
      // Completed copies recover through their existing receipt; source access
      // need not be retained after separate confirmation.
      if (original.ready_at === null) {
        const binding = await call(client, 'get_creator_page_event_media_verification', args);
        if (!record(binding) || binding.user_id !== actor || !record(binding.destination)
          || binding.destination.media_id !== body.mediaId || binding.destination.page_id !== body.pageId || binding.destination.event_id !== body.eventId) throw new HandlerFailure(503);
        // Only the authoritative backend binding selects upload versus reuse.
        const upload = binding.version === 2 && binding.kind === 'upload' && !('source' in binding);
        const reuse = binding.version === 1 && !('kind' in binding) && record(binding.source);
        if (!upload && !reuse) throw new HandlerFailure(503);
        const destination = media(binding.destination), captured = canonical(binding);
        const common = { supabaseUrl: deps.supabaseUrl, anonKey: deps.anonKey, authorization, signal: controller.signal, timeoutMs };
        const result = upload
          ? await bounded(() => (deps.verifyUploadBytes ?? verifyEventMediaUploadBytes)({ ...common, media: destination }))
          : await bounded(() => (deps.verifyBytes ?? verifyEventMediaReuseBytes)({ ...common, source: media(binding.source), destination }));
        if (canonical(await call(client, 'get_creator_page_event_media_verification', args)) !== captured) throw new HandlerFailure(409);
        current();
        await call(deps.verifierClient(controller.signal), 'record_creator_page_event_media_verification', {
          p_binding: binding, p_raw_sha256: result.rawSha256, p_source_digest_kind: result.sourceDigestKind,
        });
      } else if (typeof original.ready_at !== 'string' || !Number.isFinite(Date.parse(original.ready_at))) throw new HandlerFailure(503);
      const receipt = await call(client, 'complete_creator_page_event_media', args);
      if (!record(receipt) || receipt.id !== body.mediaId || receipt.page_id !== body.pageId || receipt.event_id !== body.eventId || receipt.created_by !== actor
        || typeof receipt.ready_at !== 'string' || !Number.isFinite(Date.parse(receipt.ready_at)) || receipt.object_present !== true || receipt.abandoned_at !== null) throw new HandlerFailure(503);
      return json(receipt);
    } catch (error) {
      const status = error instanceof HandlerFailure ? error.status : error instanceof EventMediaIntegrityError
        ? error.code === 'interrupted' ? 504 : error.code === 'unavailable' ? 502 : 409 : 503;
      return json({ error: status === 401 ? 'sign in required' : status === 403 ? 'media access unavailable' : status === 400 || status === 413 ? 'check the verification request' : 'verification could not be confirmed; check the original attempt' }, status);
    } finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); }
  };
}
