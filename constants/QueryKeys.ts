export const PROFILE_PHOTO_KEY = ['profile-photo'] as const;
export const INBOX_COUNT_KEY = ['inbox-count'] as const;
export const UNREAD_CHATS_KEY = ['unread-chats-count'] as const;

// Backs both the waitlist-exceptions manager route and the plan-detail
// "Waitlist (N)" count so they share one cache entry.
export const WAITLIST_MANAGER_KEY = (eventId: string) =>
  ['waitlist', 'manager', eventId] as const;
