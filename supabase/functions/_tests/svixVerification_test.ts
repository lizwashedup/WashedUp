const assert = (value: unknown, message?: string) => {
  if (!value) throw new Error(message ?? "assertion failed");
};
const assertEquals = (left: unknown, right: unknown) => {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(
      `expected ${JSON.stringify(right)}, got ${JSON.stringify(left)}`,
    );
  }
};
import {
  parseSvixSignatureHeader,
  verifySvixRequest,
} from "../_shared/svixVerification.ts";

async function signed(
  rawBody: string,
  id: string,
  timestamp: string,
  secret = "whsec_aA==",
) {
  const encoded = secret.slice(6);
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
    ),
  );
  return btoa(String.fromCharCode(...signature));
}

Deno.test("Svix parser accepts v1 signatures and ignores other versions", () => {
  assertEquals(parseSvixSignatureHeader("v1,abc v0,old v1,def"), [
    "abc",
    "def",
  ]);
});

Deno.test("Svix rejects missing, stale, and invalid signatures", async () => {
  const missing = await verifySvixRequest(
    "{}",
    { id: null, timestamp: null, signature: null },
    "",
    1000,
  );
  assertEquals(missing.ok, false);
  const stale = await verifySvixRequest(
    "{}",
    { id: "evt", timestamp: "1", signature: "v1,abc" },
    "whsec_aA==",
    1000,
  );
  assertEquals(stale.ok, false);
  const invalid = await verifySvixRequest(
    "{}",
    { id: "evt", timestamp: "1000", signature: "v1,abc" },
    "whsec_aA==",
    1000,
  );
  assertEquals(invalid.ok, false);
  assert(!missing.ok && !stale.ok && !invalid.ok);
});

Deno.test("Svix verifies raw body, rejects mutation, and accepts multiple signatures", async () => {
  const body = '{"type":"email.bounced"}';
  const id = "evt-valid";
  const timestamp = "1000";
  const valid = await signed(body, id, timestamp);
  const headers = { id, timestamp, signature: `v0,garbage v1,${valid}` };
  assertEquals(
    (await verifySvixRequest(body, headers, "whsec_aA==", 1000)).ok,
    true,
  );
  assertEquals(
    (await verifySvixRequest(
      '{"type":"email.complained"}',
      headers,
      "whsec_aA==",
      1000,
    )).ok,
    false,
  );
});

Deno.test("Svix rejects malformed secret and signature", async () => {
  const result = await verifySvixRequest(
    "{}",
    { id: "evt", timestamp: "1000", signature: "v1,%%%" },
    "whsec_not-base64",
    1000,
  );
  assertEquals(result.ok, false);
});
