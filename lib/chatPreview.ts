import type { InboxMessageEvidence } from './inboxMessageEvidence';
import { compareChatTimestamps as comparePreviewTimes } from './chatTimestamp';
export { comparePreviewTimes };

export interface ChatPreview {
  // A conversation row is either a plan (event) chat or a circle chat.
  kind: 'event' | 'circle';
  // Generic id used for routing + list keys, regardless of kind.
  conversationId: string;
  // Event rows only (kept so event-specific call sites keep compiling).
  eventId?: string;
  title: string;
  category: string | null;
  image_url: string | null;
  start_time: string;
  end_time?: string | null;
  member_count: number;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  inbox_evidence?: InboxMessageEvidence;
  last_message_user_id?: string | null;
  unread_by_author?: Record<string, number>;
  preview_unavailable?: boolean;
  is_past: boolean;
  ticket_url: string | null;
  member_avatars: string[];
  // A DM (unnamed 2-person circle): the row shows the counterpart's face, not a
  // circle monogram. Undefined for plans and real circles.
  is_dm?: boolean;
  /** Identity used only to remove a blocked private conversation from previews. */
  dm_user_id?: string | null;
}

/** Shared text for fetched and live chat-list previews. */
export function formatChatPreview(message: {
  content?: string | null;
  message_type?: string | null;
  audio_url?: string | null;
  image_url?: string | null;
}, senderName: string | null): string | null {
  const text = message.message_type === 'audio' || message.audio_url
    ? 'sent a voice message'
    : message.image_url ? 'sent a photo' : message.content ?? null;
  return senderName ? `${senderName}: ${text ?? ''}` : text;
}

export function copyPreviewActivity(row: ChatPreview, activity: ChatPreview): ChatPreview {
  return { ...row, last_message: activity.last_message, last_message_at: activity.last_message_at,
    last_message_user_id: activity.last_message_user_id, unread_count: activity.unread_count,
    inbox_evidence: activity.inbox_evidence, unread_by_author: activity.unread_by_author, preview_unavailable: activity.preview_unavailable };
}

// Keep the joined group itself available while its message visibility is checked.
export function restrictGroupPreview(row: ChatPreview, blocked: ReadonlySet<string> | null): ChatPreview {
  if (row.is_dm || blocked?.size === 0) return row;
  const hideText = !blocked || !row.last_message_user_id || blocked.has(row.last_message_user_id);
  const counts = Object.entries(row.unread_by_author ?? {}).filter(([id]) => blocked && !blocked.has(id));
  const unread = counts.reduce((total, [, count]) => total + count, 0);
  if ((!hideText || (!row.last_message && !row.last_message_at)) && unread === row.unread_count) return row;
  return {
    ...row,
    ...(hideText && {last_message: null, last_message_at: null, last_message_user_id: null, preview_unavailable: true}),
    unread_by_author: Object.fromEntries(counts), unread_count: unread,
  };
}

type PreviewMessage = { inbox_evidence?: InboxMessageEvidence; last_message: string | null; last_message_at: string | null; unread_count: number; last_message_user_id?: string | null; unread_by_author?: Record<string, number> };

/** Only pass live changes received during this read. The fetched row still
 * owns membership, title and other metadata. Never add a missing row here.
 * Counts overlap, so retain the larger known count rather than adding them;
 * the next authoritative refresh can reconcile read receipts normally. */
export function reconcilePreviewSnapshot<T extends PreviewMessage>(snapshot: T, live?: PreviewMessage): T {
  if (!live || comparePreviewTimes(live.last_message_at, snapshot.last_message_at) <= 0) return snapshot;
  const fresh = snapshot.inbox_evidence;
  const previous = live.inbox_evidence;
  let evidence = fresh ?? previous;
  if (fresh && previous) {
    const ids = [...new Set([...fresh.ids, ...previous.ids])];
    let uncertainThrough = comparePreviewTimes(fresh.uncertainThrough, previous.uncertainThrough) >= 0
      ? fresh.uncertainThrough : previous.uncertainThrough;
    if (ids.length > 64 && comparePreviewTimes(live.last_message_at, uncertainThrough) > 0) uncertainThrough = live.last_message_at!;
    evidence = { ...fresh, uncertainThrough, ids: ids.slice(0,64) };
  }
  return { ...snapshot, ...(evidence && { inbox_evidence: evidence }), last_message: live.last_message, last_message_at: live.last_message_at,
    last_message_user_id: live.last_message_user_id,
    unread_by_author: live.unread_count >= snapshot.unread_count ? live.unread_by_author : snapshot.unread_by_author,
    unread_count: Math.max(snapshot.unread_count, live.unread_count) };
}
