import type { CreatorPageScope } from './creatorPageReview';
import { canReadCreatorTickets, scopedTicketRequest } from './creatorTicketRead';
import { supabase } from './supabase';
import { getEventAttendees } from './ticketAttendees';
import { getEventRsvpGoingCount } from './attendeeMessaging';

export class CommunicationAudienceDenied extends Error {
  constructor(){super('Event audience access is no longer available.');this.name='CommunicationAudienceDenied';}
}

export interface CommunicationEvent { id: string; title: string; image: string | null; venue: string | null }
/** Audience source reads keep the same ticket RLS authority; page-content access never grants contact access. */
export async function getCommunicationEvent(id: string, scope: CreatorPageScope): Promise<CommunicationEvent | null> {
  if (!await canReadCreatorTickets(id, scope)) return null;
  const { data, error } = await scopedTicketRequest(scope, () => supabase.from('explore_events')
    .select('id,title,image_url,venue').eq('id', id).maybeSingle());
  if (error) throw error;
  if (!data) return null;
  if (data.id !== id || typeof data.title !== 'string') throw Error('This event could not be loaded.');
  return { id, title: data.title, image: typeof data.image_url === 'string' ? data.image_url : null,
    venue: typeof data.venue === 'string' ? data.venue : null };
}
export async function getCommunicationAudienceSources(id: string, scope: CreatorPageScope) {
  if (!await canReadCreatorTickets(id, scope)) throw new CommunicationAudienceDenied();
  const [seats, rsvps] = await Promise.all([getEventAttendees(id, scope), getEventRsvpGoingCount(id, scope)]);
  if (!scope.isCurrent()) throw Error('This event visit has ended.');
  return { seats, rsvps };
}
export async function getCommunicationAudience(id: string, scope: CreatorPageScope) {
  const { seats, rsvps } = await getCommunicationAudienceSources(id, scope);
  // Purchases are not distinct recipients: one person may buy twice or also RSVP.
  return { purchases: new Set(seats.map(seat => seat.orderId)).size, rsvps };
}
