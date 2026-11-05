// Postgres timestamps can use different UTC spellings and retain microseconds.
// Date.parse alone truncates the final three digits, while string ordering can
// put 21:00:00Z after 21:00:00.100+00:00.
function timestampMicroseconds(value: string | null | undefined): number {
  if (!value) return -Infinity;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return -Infinity;
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/i)?.[1] ?? '';
  return milliseconds * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
}

export function compareChatTimestamps(left: string | null | undefined, right: string | null | undefined): number {
  const a = timestampMicroseconds(left), b = timestampMicroseconds(right);
  return a === b ? 0 : a > b ? 1 : -1;
}
