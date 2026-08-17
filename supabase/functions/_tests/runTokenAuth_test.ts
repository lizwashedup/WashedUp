import { isAuthorizedRunToken } from "../_shared/runTokenAuth.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("run-token authorization accepts only an exact non-empty match", () => {
  assert(
    isAuthorizedRunToken("expected-token", "expected-token"),
    "exact match should pass",
  );
});

for (
  const [name, givenToken, expectedToken] of [
    ["missing expected token", "given-token", undefined],
    ["empty expected token", "given-token", ""],
    ["empty given token", "", "expected-token"],
    ["missing given token", null, "expected-token"],
    ["wrong-length token", "short", "expected-token"],
    ["wrong-value token", "expected-tokem", "expected-token"],
    ["malformed token", "Bearer expected-token", "expected-token"],
  ] as const
) {
  Deno.test(`${name} is rejected`, () => {
    assert(
      !isAuthorizedRunToken(givenToken, expectedToken),
      `${name} must reject`,
    );
  });
}
