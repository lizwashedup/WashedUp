/**
 * WashedUp — US phone number formatting utilities.
 *
 * v1: US-only (+1). When we add international support, expand isValidUSPhone
 * into a country-aware validator and add a country picker to PhoneInput.
 */

export function stripDigits(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Convert a 10-digit US number to E.164 ("+1XXXXXXXXXX").
 * Caller is expected to pass exactly 10 digits; non-digits are stripped
 * defensively. Behavior on != 10 digits is "best effort" — returns +1
 * prefixed by whatever digits were given.
 */
export function formatToE164(digits10: string): string {
  const d = stripDigits(digits10);
  return `+1${d}`;
}

/**
 * Format a 10-digit US number as "(213) 555-0100".
 * Partial inputs format progressively as the user types:
 *   ""           → ""
 *   "2"          → "(2"
 *   "213"        → "(213) "
 *   "2135"       → "(213) 5"
 *   "213555"     → "(213) 555"
 *   "2135550"    → "(213) 555-0"
 *   "2135550100" → "(213) 555-0100"
 */
export function formatDisplay(digits: string): string {
  const d = stripDigits(digits).slice(0, 10);
  if (d.length === 0) return '';
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Returns true when `digits10` is exactly 10 digits and the area code is
 * not 0 or 1 (NANP rule: area codes start 2–9).
 */
export function isValidUSPhone(digits10: string): boolean {
  const d = stripDigits(digits10);
  if (d.length !== 10) return false;
  const areaFirst = d.charCodeAt(0);
  return areaFirst >= 50 /* '2' */ && areaFirst <= 57 /* '9' */;
}
