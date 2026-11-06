import { useMemo } from 'react';
import type { ChatPreview } from '../lib/chatPreview';
import { getPlanChatExpiry } from '../lib/planChatExpiry';
import { useBoundaryClock } from './usePlanClock';

/** Move the visible plan to history when it expires, independently of inbox reads. */
export function useInboxArchiveSections(chats: readonly ChatPreview[]) {
  const { cutoffs, deadlines } = useMemo(() => {
    const cutoffs = new Map<ChatPreview, number>();
    for (const chat of chats) {
      if (chat.kind !== 'event' || chat.is_past) continue;
      const expiresAt = getPlanChatExpiry(chat.start_time, chat.end_time);
      if (expiresAt) cutoffs.set(chat, expiresAt.getTime());
    }
    return { cutoffs, deadlines: [...new Set(cutoffs.values())].sort((a,b) => a-b) };
  }, [chats]);
  const nextAfter = (now: number) => deadlines.find(time => time > now) ?? Infinity;
  const next = nextAfter(useBoundaryClock(nextAfter));
  // The partition stays the same between two consecutive deadlines.
  return useMemo(() => {
    const activeChats: ChatPreview[] = [], pastChats: ChatPreview[] = [];
    for (const chat of chats) {
      const cutoff = cutoffs.get(chat);
      if (chat.is_past) pastChats.push(chat);
      else if (cutoff !== undefined && cutoff < next) pastChats.push({ ...chat, is_past: true });
      else activeChats.push(chat);
    }
    return { activeChats, pastChats };
  }, [chats, cutoffs, next]);
}
