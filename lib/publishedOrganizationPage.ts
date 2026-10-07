/** Organization public projection: its approved identity and its linked public events only. */
import { supabase } from './supabase';
import { loadPublishedPageIdentity, checkPublishedPageScope } from './publishedPageIdentity';
import type { PageImageScope } from './publishedPageCover';
import { applySceneFeedPolicy } from './sceneDiscovery';
import { CreatorPageScopeExpired } from './creatorPageReview';
export interface PublishedOrganizationEvent {
  id: string; title: string; event_date: string | null; start_time: string | null; end_time: string | null;
  venue: string | null; image_url: string | null; category: string | null; ticket_price: number | string | null;
}
const columns = 'id,title,event_date,start_time,end_time,venue,image_url,category,ticket_price,status,community_id';
const current = (scope: PageImageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
export async function loadPublishedOrganizationPage(pageId: string, scope: PageImageScope, now = Date.now()) {
  const page = await loadPublishedPageIdentity(pageId, scope);
  if (!page || page.kind !== 'organization') return null;
  const eventIds = new Set<string>();
  // The link table includes private preparation for the owner. Never treat that as public event eligibility.
  for (let offset = 0; ; offset += 100) {
    const result = await supabase.from('creator_page_events').select('event_id,page_id').eq('page_id', pageId)
      .order('event_id', { ascending: true }).range(offset, offset + 99); current(scope);
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    for (const row of rows) {
      if (row.page_id !== pageId || typeof row.event_id !== 'string' || eventIds.has(row.event_id)) throw new Error('Could not load this page’s events.');
      eventIds.add(row.event_id);
    }
    if (rows.length < 100) break;
  }
  const events: PublishedOrganizationEvent[] = [];
  const ids = [...eventIds];
  for (let offset = 0; offset < ids.length; offset += 100) {
    current(scope); const batch = ids.slice(offset, offset + 100);
    const result = await supabase.from('explore_events').select(columns).in('id', batch).eq('status', 'Live').is('community_id', null); current(scope);
    if (result.error) throw result.error;
    for (const event of result.data ?? []) {
      if (!batch.includes(event.id) || event.status !== 'Live' || event.community_id !== null || typeof event.title !== 'string') throw new Error('Could not load this page’s public events.');
      events.push(event);
    }
  }
  await checkPublishedPageScope(scope);
  const upcomingEvents = applySceneFeedPolicy(events, now);
  const upcomingIds = new Set(upcomingEvents.map(event => event.id));
  // Same end-time-first clock as Scene. Ended-but-Live public events appear as past; private Completed rows do not.
  const pastEvents = events.filter(event => !upcomingIds.has(event.id)).sort((a,b) =>
    (b.end_time ?? b.start_time ?? b.event_date ?? '').localeCompare(a.end_time ?? a.start_time ?? a.event_date ?? ''));
  return { page, upcomingEvents, pastEvents };
}
