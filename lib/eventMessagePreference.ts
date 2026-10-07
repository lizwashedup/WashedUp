import { supabase } from './supabase';
import type { CreatorPageScope } from './creatorPageReview';
import { scopedTicketRequest } from './creatorTicketRead';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validate(eventId: string, scope: CreatorPageScope) {
  if (!uuid.test(eventId) || !uuid.test(scope.userId)) throw new Error('This event preference could not be checked.');
}
export async function readEventMessagePreference(eventId: string, scope: CreatorPageScope): Promise<boolean> {
  validate(eventId, scope);
  const { data, error } = await scopedTicketRequest(scope, () => supabase.from('attendee_message_opt_outs')
    .select('event_id,user_id').eq('event_id', eventId).eq('user_id', scope.userId).maybeSingle());
  if (error) throw new Error('Could not check event updates.');
  if (data === null) return false;
  if (data?.event_id !== eventId || data?.user_id !== scope.userId) throw new Error('Could not confirm event updates.');
  return true;
}
/** Existing own-row RLS, pinned to the initiating account; no creator authority. */
export async function saveEventMessagePreference(eventId: string, muted: boolean, scope: CreatorPageScope): Promise<void> {
  validate(eventId, scope);
  if (typeof muted !== 'boolean') throw new Error('Choose an event update preference.');
  const { data, error } = await scopedTicketRequest(scope, () => muted
    ? supabase.from('attendee_message_opt_outs').upsert({ event_id: eventId, user_id: scope.userId }, { onConflict: 'event_id,user_id' }).select('event_id,user_id')
    : supabase.from('attendee_message_opt_outs').delete().eq('event_id', eventId).eq('user_id', scope.userId).select('event_id,user_id'));
  if (error || !Array.isArray(data) || data.length > 1 || (muted && data.length !== 1)
    || data.some(row => row.event_id !== eventId || row.user_id !== scope.userId)) throw new Error('Check whether your event preference saved.');
}
