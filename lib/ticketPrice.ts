/**
 * One reading of explore_events.ticket_price for every surface (doc 34 2.3).
 *
 * The column is Postgres numeric, but the client has treated it as a string
 * in some places and a number in others, and the free-or-not checks leaned
 * on typeof. Normalize once here: a positive number means priced, null means
 * free (empty, zero, null, or unparseable all read as free, matching the
 * form's "leave empty if free").
 */

export function normalizeTicketPrice(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

/** Currency-format a normalized price: $20 whole, $28.52 when cents matter. */
export function formatTicketPrice(price: number): string {
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}
