/**
 * Pure ordering rules shared by the live chat readers. Database rows use the
 * compound `(created_at, id)` order so a page boundary cannot lose messages
 * that were written in the same timestamp tick.
 */
export const CHAT_NEWEST_PAGE_SIZE = 60;
export const CHAT_REALTIME_BURST_MS = 80;

export interface ChatSequenceItem {
  id: string;
  created_at: string;
}

export interface ChatPageCursor {
  created_at: string;
  id: string;
}

export function compareChatSequence(a: ChatSequenceItem, b: ChatSequenceItem): number {
  return a.created_at === b.created_at
    ? a.id.localeCompare(b.id)
    : a.created_at.localeCompare(b.created_at);
}

/** Turns a newest-first database page back into the list's oldest-first order. */
export function toChronologicalChatPage<T extends ChatSequenceItem>(rows: readonly T[]): T[] {
  return [...rows].sort(compareChatSequence);
}

/** The first chronological persisted row is the safe cursor for the next older page. */
export function oldestChatCursor<T extends ChatSequenceItem>(rows: readonly T[]): ChatPageCursor | null {
  if (rows.length === 0) return null;
  const oldest = rows.reduce((current, row) =>
    compareChatSequence(row, current) < 0 ? row : current,
  );
  return { created_at: oldest.created_at, id: oldest.id };
}

/** PostgREST predicate for rows strictly before a compound chat cursor. */
export function olderChatFilter(cursor: ChatPageCursor): string {
  return `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
}

/**
 * Dedupes a realtime burst and restores chronological order. The later burst
 * row wins for an existing database id, making replayed INSERT payloads
 * harmless and giving callers one state update per flushed burst.
 */
export function mergeChatBurst<T extends ChatSequenceItem>(
  current: readonly T[],
  burst: readonly T[],
): T[] {
  const rows = new Map<string, T>();
  current.forEach((row) => rows.set(row.id, row));
  burst.forEach((row) => rows.set(row.id, row));
  return toChronologicalChatPage([...rows.values()]);
}

/**
 * Replaces the refreshed newest window while retaining pages that are strictly
 * older than that window. Rows missing from the refreshed window disappear,
 * so a background delete does not survive a focus refresh.
 */
export function replaceNewestChatPage<T extends ChatSequenceItem>(
  current: readonly T[],
  newestPage: readonly T[],
): T[] {
  const newest = toChronologicalChatPage(newestPage);
  if (newest.length === 0) return [];
  const cutoff = newest[0];
  const older = current.filter((row) => compareChatSequence(row, cutoff) < 0);
  return mergeChatBurst(older, newest);
}
