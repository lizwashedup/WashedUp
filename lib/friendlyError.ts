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
];

function looksLikeRawDbError(message: string): boolean {
  return RAW_DB_ERROR_PATTERNS.some((re) => re.test(message));
}

export function friendlyError(err: unknown, fallback: string): string {
  const message =
    typeof err === 'string'
      ? err
      : (err as { message?: unknown } | null)?.message;

  if (typeof message !== 'string' || message.length === 0) {
    return fallback;
  }

  if (looksLikeRawDbError(message)) {
    console.error('[friendlyError] suppressed raw error:', err);
    return fallback;
  }

  return message;
}
