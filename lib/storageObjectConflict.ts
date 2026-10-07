/** Only an immutable, caller-owned object path may use this as a retry receipt.
 * Supabase SDKs preserve either a named code or a legacy numeric statusCode. */
export function isStorageObjectConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  const httpStatus = Number(value.status);
  const bodyStatus = Number(value.statusCode);
  // In particular, HTTP 400 may wrap a body-level permission error.
  if ([httpStatus, bodyStatus].some(status => Number.isFinite(status) && status !== 400 && status !== 409)) return false;
  const code = value.code ?? value.statusCode;
  if (code === 'ResourceAlreadyExists' || code === 'KeyAlreadyExists' || code === 'already_exists') return true;
  // A conflicting named error must not be overruled by its human-readable text.
  if (typeof code === 'string' && code !== '400' && code !== '409') return false;
  if (![httpStatus, bodyStatus].some(status => status === 400 || status === 409)) return false;
  const message = typeof value.message === 'string' ? value.message.trim().toLowerCase().replace(/\.$/, '') : '';
  return message === 'the resource already exists' || message === 'asset already exists';
}
