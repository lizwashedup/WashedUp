import type { CommunityChatRowData } from './communityChat';

export function communityNotificationLabel(row: CommunityChatRowData): string | null {
  const persistent = row.kind === 'community' || row.eventId === null;
  if (persistent && row.communityMuted === null) return 'Notification setting unavailable';
  if (persistent && row.communityMuted === true) return 'All community chats muted';
  return row.roomNotificationsOn === false ? 'Chat muted' : null;
}
