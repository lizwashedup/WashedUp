import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

export type ReservedSpotGrant = { rowId: string; invitedAt: string | null };
export type ReservedSpotReply = 'accept' | 'decline';
type Ticket = { kind: ReservedSpotReply };
const pending = new WeakMap<QueryClient, Map<string, Ticket>>();

// A new visit can check the original reply. A different member or grant has a separate key.
export function reservedSpotReceipts(client: QueryClient) {
  let map = pending.get(client);
  if (!map) {
    map = new Map();
    pending.set(client, map);
  }
  return map;
}

export function isDefiniteSpotRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String(error.code);
  // 40003 means statement completion is unknown. Only the two definite
  // transaction rollbacks below permit another explicit submission.
  return code === 'P0001' || code === '40001' || code === '40P01' || /^(22|23|28|42)/.test(code);
}

export async function checkReservedSpotReply(
  kind: ReservedSpotReply, eventId: string, viewerId: string, grant: ReservedSpotGrant,
): Promise<'confirmed' | 'changed' | 'unknown'> {
  if (kind === 'accept') {
    const member = await requestWithDeadline(supabase.from('event_members').select('event_id,user_id,status')
      .eq('event_id', eventId).eq('user_id', viewerId).eq('status', 'joined').maybeSingle(), 8000);
    if (member.error !== null) return 'unknown';
    if (member.data) {
      return member.data.event_id === eventId && member.data.user_id === viewerId && member.data.status === 'joined'
        ? 'confirmed' : 'unknown';
    }
  }
  const result = await requestWithDeadline(supabase.from('event_waitlist')
    .select('id,event_id,user_id,exception_status,exception_invited_at')
    .eq('event_id', eventId).eq('user_id', viewerId).maybeSingle(), 8000);
  if (result.error !== null || !result.data) return 'unknown';
  const row = result.data;
  if (row.event_id !== eventId || row.user_id !== viewerId || !row.id) return 'unknown';
  if (row.id !== grant.rowId || (row.exception_invited_at ?? null) !== grant.invitedAt) return 'changed';
  if (kind === 'decline' && row.exception_status === 'declined') return 'confirmed';
  return row.exception_status === 'expired' ? 'changed' : 'unknown';
}
