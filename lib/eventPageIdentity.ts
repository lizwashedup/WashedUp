import type { PublishedEventPageIdentity, PublishedPageIdentity } from './publishedPageIdentity';

/** A missing link is legacy; a known unavailable page is deliberately not an account fallback. */
export function eventPageIdentity(event: { community_id: string | null }, link: PublishedEventPageIdentity | undefined): PublishedPageIdentity | null | undefined {
  if (!link) return undefined;
  if (!link.page) return null;
  const page = link.page;
  if (page.pageId !== link.pageId || (page.kind === 'community' ? event.community_id !== page.pageId : !!event.community_id)) {
    throw new Error('This event’s page could not be confirmed.');
  }
  return page;
}

export function eventPageByline(event: { published_page?: PublishedPageIdentity | null; public_name: string | null; organizer_name?: string | null }) {
  return event.published_page !== undefined ? event.published_page?.name ?? null : event.public_name || event.organizer_name || null;
}
