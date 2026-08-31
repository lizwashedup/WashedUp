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
  boundedLimit,
  providerResult,
  shouldCreateAfterPatch,
} from "../_shared/audienceSync.ts";

Deno.test("audience provider policy only creates after confirmed 404", () => {
  assert(shouldCreateAfterPatch(404));
  assert(!shouldCreateAfterPatch(400));
  assertEquals(providerResult(200, true).kind, "confirmed");
  assertEquals(providerResult(429, true).kind, "retryable");
  assertEquals(providerResult(422, true).kind, "terminal");
});

Deno.test("audience drain bounds requested batch", () => {
  assertEquals(boundedLimit(500), 100);
  assertEquals(boundedLimit(500, 10, 10), 10);
  assertEquals(boundedLimit(0), 1);
  assertEquals(boundedLimit("bad"), 25);
});
