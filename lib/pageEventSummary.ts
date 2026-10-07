import type { CreatorPageScope } from './creatorPageReview';
import { getPageEventReuseWorkspace } from './creatorPageEventReuseEntry';
import { canReadCreatorTickets } from './creatorTicketRead';

/** Reuse exact-page event authority. Editing a page never grants buyer access. */
export async function getPageEventSummaryAccess(pageId: string, eventId: string, scope: CreatorPageScope) {
  const page = await getPageEventReuseWorkspace(pageId, scope);
  if (!scope.isCurrent() || !page.events.some(event => event.id === eventId)) {
    throw new Error('This event is unavailable for this page.');
  }
  const finance = await canReadCreatorTickets(eventId, scope);
  if (!scope.isCurrent()) throw new Error('This event visit has ended.');
  return { pageId, entry: page.entry, events: true, audience: finance, finance };
}
