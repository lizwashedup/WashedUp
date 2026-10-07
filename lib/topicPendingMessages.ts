import type { TopicMessage } from './communityChat';

/** Server rows win when the same client-generated id appears in a refresh. */
export function mergeTopicMessagesWithPending(
  rows: TopicMessage[], pending: Iterable<TopicMessage>,
): TopicMessage[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const message of pending) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
