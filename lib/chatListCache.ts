import type { ChatPreview } from '../hooks/useChatList';
import { markChatListDirty } from './chatListSignal';

// Process-only previews, partitioned by account. Block confirmation must clear
// them even when Chats is unmounted, before another visit can paint old rows.
export const chatListMemoryCache = new Map<string, ChatPreview[]>();
const listeners = new Set<(viewerId: string, blockedId: string) => void>();

export function removeBlockedPrivateChatPreviews(viewerId: string, blockedId: string): void {
  const previous = chatListMemoryCache.get(viewerId);
  if (previous) chatListMemoryCache.set(viewerId,
    previous.filter(chat => !(chat.is_dm && chat.dm_user_id === blockedId)));
  markChatListDirty();
  for (const listener of listeners) listener(viewerId, blockedId);
}

export function subscribeChatListPrivacy(listener: (viewerId: string, blockedId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
