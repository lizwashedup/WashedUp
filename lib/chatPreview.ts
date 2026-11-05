import { compareChatTimestamps as comparePreviewTimes } from './chatTimestamp';
export { comparePreviewTimes };

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
