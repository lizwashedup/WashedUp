/** PostgreSQL timestamps retain microseconds. Date.parse alone drops the last
 * three digits and can mistake a changed version for the original. */
function version(value: string) {
  const match = typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:?\d{2})$/);
  const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds)) throw Error('Could not compare the saved event versions.');
  const fraction = (match[1] ?? '').padEnd(6, '0');
  const microseconds = milliseconds * 1000 + Number(fraction.slice(3));
  if (!Number.isSafeInteger(microseconds)) throw Error('Could not compare the saved event versions.');
  return microseconds;
}
export function sameEventSaveVersion(a: string, b: string) { return version(a) === version(b); }
