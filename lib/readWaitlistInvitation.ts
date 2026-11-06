import { requestWithDeadline } from './requestWithDeadline';
import { supabase } from './supabase';

export type WaitlistInvitationState = 'invited' | 'declined' | 'expired' | 'inactive' | 'unavailable';

export async function readWaitlistInvitation(userId: string, eventId: string, notificationCreatedAt: string): Promise<WaitlistInvitationState> {
  const result = await requestWithDeadline(supabase.from('event_waitlist')
    .select('event_id,user_id,exception_status,exception_invited_at,exception_expires_at')
    .eq('user_id', userId).eq('event_id', eventId).maybeSingle(), 12_000);
  const row = result.data;
  if (result.error || !row || row.user_id !== userId || row.event_id !== eventId) return 'unavailable';

  // A new offer on the same waitlist row belongs to its own notification.
  const created = Date.parse(notificationCreatedAt);
  if (!Number.isFinite(created)) return 'unavailable';
  if (row.exception_invited_at) {
    const issued = Date.parse(row.exception_invited_at);
    if (!Number.isFinite(issued)) return 'unavailable';
    if (issued > created) return 'inactive';
  }
  if (row.exception_status === 'declined' || row.exception_status === 'expired') return row.exception_status;
  if (row.exception_status !== 'invited') return 'inactive';
  if (row.exception_expires_at) {
    const expires = Date.parse(row.exception_expires_at);
    if (!Number.isFinite(expires)) return 'unavailable';
    if (expires <= Date.now()) return 'expired';
  }
  return 'invited';
}
