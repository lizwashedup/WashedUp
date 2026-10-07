import { supabase } from './supabase';
import type { CreatorPageScope } from './creatorPageReview';
import { canReadCreatorTickets, scopedTicketRequest } from './creatorTicketRead';

export interface EventRegistrationKind { freeRsvp: boolean; hasTickets: boolean }
export class RsvpAccessDenied extends Error {
  constructor() { super('RSVP guest access is not available for this account.'); }
}

/** The selected offer drives presentation; old orders/tiers must stay reachable. */
export async function getEventRegistrationKind(id: string, scope: CreatorPageScope): Promise<EventRegistrationKind> {
  if (!id || !await canReadCreatorTickets(id, scope)) throw Error('Event registration access is unavailable.');
  const event = await scopedTicketRequest(scope, () => supabase.from('explore_events').select('id,offer_type').eq('id', id).maybeSingle());
  if (event.error) throw event.error;
  if (event.data?.id !== id || typeof event.data.offer_type !== 'string') throw Error('Event registration could not be checked.');
  if (event.data.offer_type !== 'free_event') return { freeRsvp: false, hasTickets: true };
  const [orders, tiers] = await Promise.all([
    scopedTicketRequest(scope, () => supabase.from('ticket_orders').select('id', { count: 'exact', head: true }).eq('event_id', id)),
    scopedTicketRequest(scope, () => supabase.from('ticket_tiers').select('id', { count: 'exact', head: true }).eq('event_id', id)),
  ]);
  for (const result of [orders, tiers]) {
    if (result.error) throw result.error;
    if (!Number.isSafeInteger(result.count) || result.count! < 0) throw Error('Ticket history could not be checked.');
  }
  return { freeRsvp: true, hasTickets: orders.count! > 0 || tiers.count! > 0 };
}

async function checkRsvpAccess(id: string, scope: CreatorPageScope) {
  if (!id || !await canReadCreatorTickets(id, scope)) throw new RsvpAccessDenied();
  const event = await scopedTicketRequest(scope, () => supabase.from('explore_events').select('id,title,host_user_id,community_id').eq('id', id).maybeSingle());
  if (event.error) throw event.error;
  if (event.data?.id !== id) throw new RsvpAccessDenied();
  // RSVP RLS is narrower than ticket RLS. A ticket delegate must not see a
  // filtered empty result presented as a confirmed zero-guest event.
  if (event.data.host_user_id !== scope.userId) {
    const leader = event.data.community_id ? await scopedTicketRequest(scope, () => supabase.rpc('is_community_leader', { p_community_id: event.data!.community_id!, p_user_id: scope.userId })) : null;
    if (leader?.error) throw leader.error;
    if (leader?.data !== true) throw new RsvpAccessDenied();
  }
  return event.data;
}

export async function getEventRsvpSummary(id: string, scope: CreatorPageScope): Promise<number> {
  await checkRsvpAccess(id, scope);
  const result = await scopedTicketRequest(scope, () => supabase.from('explore_event_rsvps').select('user_id', { count: 'exact', head: true }).eq('explore_event_id', id).eq('status', 'going'));
  if (result.error) throw result.error;
  if (!Number.isSafeInteger(result.count) || result.count! < 0) throw Error('RSVPs could not be loaded.');
  return result.count!;
}

export interface RsvpGuest { id: string; name: string; photo: string | null }
export async function getEventRsvpGuests(id: string, scope: CreatorPageScope): Promise<{ title: string; guests: RsvpGuest[] }> {
  const event = await checkRsvpAccess(id, scope);
  const guests: RsvpGuest[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await scopedTicketRequest(scope, () => supabase.from('explore_event_rsvps').select('user_id').eq('explore_event_id', id).eq('status', 'going').order('user_id', { ascending: true }).range(offset, offset + pageSize - 1));
    if (rows.error) throw rows.error;
    if (!Array.isArray(rows.data) || rows.data.some(row => typeof row.user_id !== 'string')) throw Error('RSVPs could not be loaded.');
    if (rows.data.length) {
      const profiles = await scopedTicketRequest(scope, () => supabase.from('profiles_public').select('id,first_name_display,profile_photo_url').in('id', rows.data!.map(row => row.user_id)));
      if (profiles.error) throw profiles.error;
      if (!Array.isArray(profiles.data)) throw Error('Guest details could not be loaded.');
      const byId = new Map(profiles.data.map(profile => [profile.id, profile]));
      guests.push(...rows.data.map(row => { const profile = byId.get(row.user_id); return { id: row.user_id, name: profile?.first_name_display?.trim() || 'Member', photo: profile?.profile_photo_url ?? null }; }));
    }
    if (rows.data.length < pageSize) return { title: event.title, guests };
  }
}
