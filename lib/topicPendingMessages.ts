import type { TopicMessage } from './communityChat';
import { compareChatSequence } from './chatPaging';

/** Server rows win when the same client-generated id appears in a refresh. */
export function mergeTopicMessagesWithPending(
  rows: TopicMessage[], pending: Iterable<TopicMessage>,
): TopicMessage[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const message of pending) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  return [...byId.values()].sort(compareChatSequence);
}
