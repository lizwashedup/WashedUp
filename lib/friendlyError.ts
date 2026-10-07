// Convert raw errors into user-safe strings.
// Postgres / PostgREST / Supabase errors leak schema details (table names,
// constraint names, column names) into .message. If we naively render that to
// users we get alerts like "violates foreign key constraint
// messages_reply_to_message_id_fkey on table messages". This helper catches
// those and substitutes a friendly fallback while still logging the raw error
// to the console so we can debug.

const RAW_DB_ERROR_PATTERNS = [
  /violates? .*constraint/i,
  /constraint ".*"/i,
  /relation ".*"/i,
  /column ".*"/i,
  /syntax error at/i,
  /duplicate key value/i,
  /^PGRST/,
  /^pgrst/i,
  /^postgrest/i,
  /null value in column/i,
  /invalid input syntax/i,
  // Internal auth-plumbing exceptions (e.g. join_event_atomic's own guards)
  // are meant for server logs, not users -- a stale/desynced session should
  // read as a generic retry-able failure, not leak the raw check that failed.
  /not authenticated/i,
  /can only join as yourself/i,
];

function looksLikeRawDbError(message: string): boolean {
  return RAW_DB_ERROR_PATTERNS.some((re) => re.test(message));
}

// Fetch failures are transport details, not instructions for a member. Keep
// each caller's recovery copy, including uncertain-send/payment safeguards.
const RAW_TRANSPORT_ERROR = /^(?:(?:TypeError|NetworkError|AbortError):\s*)?(?:Network request failed|Failed to fetch|NetworkError when attempting to fetch resource\.?|The operation was aborted\.?|This operation was aborted\.?)$/i;
const RAW_FUNCTION_ERROR = /^(?:Edge Function returned a non-2xx status code|Failed to send a request to the Edge Function|Relay Error invoking the Edge Function)$/i;

export function friendlyError(err: unknown, fallback: string): string {
  const message =
    typeof err === 'string'
      ? err
      : (err as { message?: unknown } | null)?.message;

  if (typeof message !== 'string' || message.length === 0) {
    return fallback;
  }

  if (RAW_TRANSPORT_ERROR.test(message.trim()) || RAW_FUNCTION_ERROR.test(message.trim())) return fallback;

  if (looksLikeRawDbError(message)) {
    console.error('[friendlyError] suppressed raw error:', err);
    return fallback;
  }

  return message;
}
