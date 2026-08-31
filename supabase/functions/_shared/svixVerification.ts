const encoder = new TextEncoder();

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function parseSvixSignatureHeader(header: string): string[] {
  return header.split(/\s+/).flatMap((part) => {
    const [version, value] = part.split(",", 2);
    return version === "v1" && value ? [value] : [];
  });
}

export async function verifySvixRequest(
  rawBody: string,
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): Promise<
  { ok: true; eventId: string; timestamp: number } | {
    ok: false;
    reason: string;
  }
> {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) {
    return { ok: false, reason: "missing headers" };
  }
  const timestamp = Number(headers.timestamp);
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > toleranceSeconds
  ) return { ok: false, reason: "stale timestamp" };
  const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let expected: Uint8Array;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      decodeBase64(key) as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    expected = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        encoder.encode(`${headers.id}.${headers.timestamp}.${rawBody}`),
      ),
    );
  } catch {
    return { ok: false, reason: "invalid secret" };
  }
  for (const candidate of parseSvixSignatureHeader(headers.signature)) {
    try {
      if (timingSafeEqual(expected, decodeBase64(candidate))) {
        return { ok: true, eventId: headers.id, timestamp };
      }
    } catch { /* malformed candidates do not verify */ }
  }
  return { ok: false, reason: "invalid signature" };
}
