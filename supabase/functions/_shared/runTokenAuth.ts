/**
 * Returns true only when a non-empty trigger token exactly matches its
 * configured counterpart. The comparison is constant time for equal lengths.
 */
export function isAuthorizedRunToken(
  givenToken: string | null | undefined,
  expectedToken: string | null | undefined,
): boolean {
  if (
    !expectedToken || !givenToken || givenToken.length !== expectedToken.length
  ) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < expectedToken.length; index += 1) {
    difference |= givenToken.charCodeAt(index) ^
      expectedToken.charCodeAt(index);
  }

  return difference === 0;
}
