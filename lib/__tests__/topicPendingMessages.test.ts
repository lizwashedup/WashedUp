import { mergeTopicMessagesWithPending } from '../topicPendingMessages';
import { oldestChatCursor, olderChatFilter, replaceNewestChatPage } from '../chatPaging';
import type { TopicMessage } from '../communityChat';

const message = (id: string, createdAt: string, body = id): TopicMessage => ({
  id, body, created_at: createdAt, sender_id: 'user', sender_name: 'Liz',
  sender_photo: null, image_url: null, reply_to_message_id: null,
  edited_at: null, reply_to: null, reactions: [],
});

describe('topic message refresh while sending', () => {
  it('keeps an unconfirmed send visible during an unrelated realtime refresh', () => {
    const pending = message('client-id', '2026-09-12T20:00:02Z');
    const rows = [message('earlier', '2026-09-12T20:00:01Z')];
    expect(mergeTopicMessagesWithPending(rows, [pending]).map((row) => row.id))
      .toEqual(['earlier', 'client-id']);
  });

  it('uses the confirmed server row once it arrives under the same id', () => {
    const pending = message('client-id', '2026-09-12T20:00:02Z', 'pending');
    const confirmed = message('client-id', '2026-09-12T20:00:03Z', 'confirmed');
    expect(mergeTopicMessagesWithPending([confirmed], [pending]))
      .toEqual([confirmed]);
  });

  it('keeps an earlier page when the newest page refreshes', () => {
    const earlier = message('a', '2026-09-12T19:00:00Z');
    const oldNewest = message('b', '2026-09-12T20:00:00Z');
    const currentNewest = message('c', '2026-09-12T21:00:00Z');
    const result = replaceNewestChatPage([earlier, oldNewest], [currentNewest]);
    expect(result.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(oldestChatCursor(result)).toEqual({ created_at: earlier.created_at, id: 'a' });
  });

  it('uses the id to page through messages with the same timestamp', () => {
    expect(olderChatFilter({ created_at: '2026-09-12T20:00:00Z', id: 'b' }))
      .toContain('id.lt.b');
  });
});
