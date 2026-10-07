import { supabase } from './supabase';
import type { CreatorPageScope } from './creatorPageReview';
import { requestWithDeadline } from './requestWithDeadline';
export function assertTicketVisit(scope?: CreatorPageScope) {
  if (scope && !scope.isCurrent()) throw new Error('This event visit is no longer active.');
}
export async function ticketReadAuthorization(scope?: CreatorPageScope): Promise<string | undefined> {
  if (!scope) return undefined;
  assertTicketVisit(scope);
  const result = await supabase.auth.getSession();
  assertTicketVisit(scope);
  if (result.error || result.data.session?.user.id !== scope.userId || !result.data.session.access_token) {
    throw new Error('Check your sign-in to load this event.');
  }
  return `Bearer ${result.data.session.access_token}`;
}
/** Same event-specific predicate as the existing ticket RLS; page content permission grants no financial authority. */
export async function canReadCreatorTickets(eventId: string, scope: CreatorPageScope): Promise<boolean> {
  const authorization = await ticketReadAuthorization(scope);
  const result = await supabase.rpc('is_ticketing_organizer', { p_event_id: eventId, p_user: scope.userId })
    .setHeader('Authorization', authorization!);
  assertTicketVisit(scope);
  if (result.error || typeof result.data !== 'boolean') throw new Error('Event access could not be checked.');
  return result.data;
}

/** Pin each existing query to its initiating account without changing its projection or filters. */
export async function scopedTicketRequest<T>(scope: CreatorPageScope | undefined, make: () => PromiseLike<T> & { setHeader(name: string, value: string): PromiseLike<T> }, timeoutMs?: number): Promise<T> {
  const authorization = await ticketReadAuthorization(scope);
  const request = make();
  const authorized = authorization ? request.setHeader('Authorization', authorization) : request;
  const result = await (timeoutMs === undefined ? authorized : requestWithDeadline(authorized, timeoutMs));
  assertTicketVisit(scope);
  return result;
}
