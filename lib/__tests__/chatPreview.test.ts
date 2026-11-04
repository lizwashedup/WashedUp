import { comparePreviewTimes, formatChatPreview } from '../chatPreview';

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
