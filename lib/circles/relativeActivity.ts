/**
 * relativeActivity - warm, compact "when was this circle last alive" formatter
 * for the circles directory ("just now" / "2h ago" / "3d ago" / "2w ago").
 * Returns null when there is nothing recent to say (no timestamp, unparseable,
 * or older than about a month); callers fall back to COPY.circleQuiet.
 */
export function relativeActivity(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then) || then > now) return null;
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return null;
}
