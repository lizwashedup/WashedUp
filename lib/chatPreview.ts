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

// Postgres timestamps can use different UTC spellings and retain microseconds.
// Date.parse alone truncates the final three digits, while string ordering can
// put 21:00:00Z after 21:00:00.100+00:00.
function previewTime(value: string | null | undefined): number {
  if (!value) return -Infinity;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return -Infinity;
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d(?::?\d\d)?)$/i)?.[1] ?? '';
  return milliseconds * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
}

export function comparePreviewTimes(left: string | null | undefined, right: string | null | undefined): number {
  const a = previewTime(left), b = previewTime(right);
  return a === b ? 0 : a > b ? 1 : -1;
}

type PreviewMessage = { last_message: string | null; last_message_at: string | null; unread_count: number };

/** Only pass live changes received during this read. The fetched row still
 * owns membership, title and other metadata. Never add a missing row here.
 * Counts overlap, so retain the larger known count rather than adding them;
 * the next authoritative refresh can reconcile read receipts normally. */
export function reconcilePreviewSnapshot<T extends PreviewMessage>(snapshot: T, live?: PreviewMessage): T {
  if (!live || comparePreviewTimes(live.last_message_at, snapshot.last_message_at) <= 0) return snapshot;
  return { ...snapshot, last_message: live.last_message, last_message_at: live.last_message_at,
    unread_count: Math.max(snapshot.unread_count, live.unread_count) };
}
