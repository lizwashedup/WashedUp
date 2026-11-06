import type { ChatPreview } from './chatPreview';
import { markChatListDirty } from './chatListSignal';

// Process-only previews, partitioned by account. Block confirmation must clear
// them even when Chats is unmounted, before another visit can paint old rows.
export const chatListMemoryCache = new Map<string, ChatPreview[]>();
const listeners = new Set<(viewerId: string, blockedId: string) => void>();

const inboxListeners = new Set<(viewerId: string) => void>();

function notifyInbox(viewerId: string) {
  markChatListDirty();
  for (const listener of inboxListeners) listener(viewerId);
}

export function subscribeChatListChanges(listener: (viewerId: string) => void): () => void {
  inboxListeners.add(listener);
  return () => { inboxListeners.delete(listener); };
}

export function removeDepartedPlanPreview(viewerId: string, eventId: string): void {
  const rows = chatListMemoryCache.get(viewerId);
  if (rows) chatListMemoryCache.set(viewerId, rows.filter(row => row.kind !== 'event' || row.conversationId !== eventId));
  notifyInbox(viewerId);
}

export function removeBlockedPrivateChatPreviews(viewerId: string, blockedId: string): void {
  const previous = chatListMemoryCache.get(viewerId);
  if (previous) chatListMemoryCache.set(viewerId,
    previous.filter(chat => !(chat.is_dm && chat.dm_user_id === blockedId)));
  notifyInbox(viewerId);
  for (const listener of listeners) listener(viewerId, blockedId);
}

export function subscribeChatListPrivacy(listener: (viewerId: string, blockedId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
