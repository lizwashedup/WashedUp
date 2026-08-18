// Pure verification logic for ticket-connect-webhook, extracted for testing
// (2026-08-18). No Stripe/Supabase I/O here — signature bytes and the
// parsed event are the caller's job; this module only decides.

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function hmacSha256Hex(secret: string, message: BufferSource): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, message);
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ParsedStripeSignature {
  rawTs: string;
  ts: number;
  v1s: string[];
}

// Stripe-Signature: t=<ts>,v1=<hex>[,v1=<hex>...] — keeps t's RAW token
// (never a re-rendered number) since that's the byte-exact value Stripe signed.
export function parseStripeSignatureHeader(header: string): ParsedStripeSignature | null {
  const parts = new Map<string, string[]>();
  for (const piece of header.split(',')) {
    const [k, v] = piece.split('=', 2);
    if (!k || !v) continue;
    const arr = parts.get(k.trim()) ?? [];
    arr.push(v.trim());
    parts.set(k.trim(), arr);
  }
  const rawTs = parts.get('t')?.[0] ?? '';
  const v1s = parts.get('v1') ?? [];
  const ts = Number(rawTs);
  if (!rawTs || !Number.isFinite(ts) || v1s.length === 0) return null;
  return { rawTs, ts, v1s };
}

export function isTimestampWithinTolerance(ts: number, nowSec: number, toleranceSec: number): boolean {
  return Math.abs(nowSec - ts) <= toleranceSec;
}

export function isValidStripeEventShape(event: unknown): event is { id: string; type: string } {
  const e = event as { id?: unknown; type?: unknown } | null;
  return !!e && typeof e.id === 'string' && e.id.startsWith('evt_') && typeof e.type === 'string';
}

// MODE BINDING (the 2026-08-14 fix). Before this, a signature match against
// ANY configured secret was accepted and event.livemode was never read, so a
// leaked TEST whsec could sign a forged body claiming livemode:true and the
// drain would act on it as real money movement. Every real Stripe snapshot
// event carries a boolean livemode; its absence means malformed or forged.
export function hasValidLivemode(event: unknown): event is { livemode: boolean } {
  return typeof (event as { livemode?: unknown } | null)?.livemode === 'boolean';
}

export function livemodeMatchesSecret(eventLivemode: boolean, secretLivemode: boolean): boolean {
  return eventLivemode === secretLivemode;
}
