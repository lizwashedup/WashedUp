import { comparePreviewTimes, formatChatPreview, reconcilePreviewSnapshot } from '../chatPreview';

it('orders microseconds that Date.parse rounds to the same millisecond', () => {
  expect(comparePreviewTimes('2026-10-07T21:00:00.000002Z', '2026-10-07T21:00:00.000001+00:00')).toBe(1);
  expect(comparePreviewTimes('2026-10-07T21:00:00.000001Z', '2026-10-07T21:00:00.000002+00:00')).toBe(-1);
});
it('treats equivalent offset timestamps as equal', () => {
  expect(comparePreviewTimes('2026-10-07T14:00:00.123456-07:00', '2026-10-07T21:00:00.123456Z')).toBe(0);
});
it('sorts valid dates ahead of missing or malformed dates', () => {
  expect(comparePreviewTimes(null, undefined)).toBe(0);
  expect(comparePreviewTimes('invalid', '2026-10-07T21:00:00Z')).toBe(-1);
});
it.each([
  [{ content: 'See you soon' }, 'Alex', 'Alex: See you soon'],
  [{ content: 'See you soon' }, null, 'See you soon'],
  [{ image_url: 'image' }, 'You', 'You: sent a photo'],
  [{ audio_url: 'voice' }, 'Alex', 'Alex: sent a voice message'],
  [{ message_type: 'audio' }, null, 'sent a voice message'],
] as const)('formats text and attachments consistently: %j', (message, sender, expected) => {
  expect(formatChatPreview(message, sender)).toBe(expected);
});

it('preserves a newer live preview without losing fetched metadata or summing overlapping unread counts', () => {
  const fetched = { title: 'Renamed plan', member_count: 4, last_message: 'Earlier', last_message_at: '2026-10-07T21:00:00Z', unread_count: 7 };
  const live = { last_message: 'Newest', last_message_at: '2026-10-07T21:00:00.000001+00:00', unread_count: 3 };
  expect(reconcilePreviewSnapshot(fetched, live)).toEqual({ ...fetched, ...live, unread_count: 7 });
  expect(reconcilePreviewSnapshot({ ...fetched, unread_count: 0 }, live).unread_count).toBe(3);
  expect(fetched.last_message).toBe('Earlier');
});

it('keeps authoritative equal/newer snapshots and normal refreshes without a concurrent live change', () => {
  const fetched = { last_message: 'Edited message', last_message_at: '2026-10-07T21:00:00Z', unread_count: 0 };
  expect(reconcilePreviewSnapshot(fetched)).toBe(fetched);
  expect(reconcilePreviewSnapshot(fetched, { ...fetched, last_message: 'Unedited', unread_count: 2 })).toBe(fetched);
  expect(reconcilePreviewSnapshot(fetched, { ...fetched, last_message_at: '2026-10-07T20:00:00Z', unread_count: 2 })).toBe(fetched);
});

it('keeps a live identity window across a legacy snapshot without fabricating evidence for an older row',()=>{
  const row={last_message:'old',last_message_at:'2026-10-07T20:00:00Z',unread_count:1};
  const live={...row,last_message:'new',last_message_at:'2026-10-07T21:00:00Z'};
  expect(reconcilePreviewSnapshot(row,live)).not.toHaveProperty('inbox_evidence');
  const evidence={ids:['first'],uncertainThrough:'2026-10-07T20:00:00Z'};
  expect(reconcilePreviewSnapshot({...row,inbox_evidence:undefined as typeof evidence | undefined},{...live,inbox_evidence:evidence}).inbox_evidence).toEqual(evidence);
});
