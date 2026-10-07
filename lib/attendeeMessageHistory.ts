import { supabase } from './supabase';
import { canReadCreatorTickets, scopedTicketRequest } from './creatorTicketRead';
import type { CreatorPageScope } from './creatorPageReview';
import { messageUuid } from './attendeeMessageContract';
export interface MessageHistoryRow { id: string; event_id: string; subject: string; body: string; recipient_count: number; created_at: string; queued_at: string | null }
export type MessageHistoryCursor = Pick<MessageHistoryRow, 'id' | 'created_at'>;
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
const pageSize = 20;
export class AttendeeMessageHistoryDenied extends Error {}
export async function loadAttendeeMessageHistory(eventId: string, scope: CreatorPageScope, cursor: MessageHistoryCursor | null = null) {
  if (!messageUuid.test(eventId) || cursor && (!messageUuid.test(cursor.id) || !date(cursor.created_at))) throw Error('Invalid message history reference.');
  if (!await canReadCreatorTickets(eventId, scope)) throw new AttendeeMessageHistoryDenied('Event message access is no longer available.');
  const { data, error } = await scopedTicketRequest(scope, () => {
    let query = supabase.from('attendee_message_sends').select('id,event_id,subject,body,recipient_count,created_at,queued_at')
      .eq('event_id', eventId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1);
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    return query;
  });
  if (error || !Array.isArray(data)) throw Error('Message history could not be loaded.');
  const seen = new Set<string>();
  for (const row of data) {
    if (typeof row.id !== 'string' || !messageUuid.test(row.id) || seen.has(row.id) || row.event_id !== eventId || typeof row.subject !== 'string' || typeof row.body !== 'string' || !Number.isSafeInteger(row.recipient_count) || row.recipient_count < 0 || !date(row.created_at) || !(row.queued_at === null || date(row.queued_at))) throw Error('Message history could not be confirmed.');
    seen.add(row.id);
  }
  const rows = data.slice(0, pageSize) as MessageHistoryRow[];
  return { rows, next: data.length > pageSize ? { id: rows[rows.length - 1].id, created_at: rows[rows.length - 1].created_at } : null };
}
