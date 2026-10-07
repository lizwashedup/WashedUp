/** Public identities resolve by immutable page ID, never by an owner's account profile. */
import { supabase } from './supabase';
import { CreatorPageScopeExpired } from './creatorPageReview';
import { getPublishedCoverMediaIds, type PageImageScope } from './publishedPageCover';
export interface PublishedPageIdentity {
  pageId: string; ownerId: string | null; kind: 'community' | 'organization'; name: string;
  purpose: string; city: string; description: string | null; photoUrl: string | null;
  coverMediaId: string | null; publishedAt: string;
}
export interface PublishedEventPageIdentity { pageId: string; page: PublishedPageIdentity | null; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = 'page_id,owner_id,page_kind,name,purpose,city,description,photo_url,published_at';
const current = (scope: PageImageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
export async function checkPublishedPageScope(scope: PageImageScope) {
  current(scope); const result = await supabase.auth.getSession(); current(scope);
  if (result.error || (result.data.session?.user.id ?? null) !== scope.userId) throw new CreatorPageScopeExpired();
}
function parse(row: any, ids: string[], covers: Map<string, string>): PublishedPageIdentity {
  if (!row || !ids.includes(row.page_id) || !['community','organization'].includes(row.page_kind)
    || !(row.owner_id === null || typeof row.owner_id === 'string' && uuid.test(row.owner_id))
    || !['name','purpose','city','published_at'].every(key => typeof row[key] === 'string')
    || !(row.description === null || typeof row.description === 'string')
    || !(row.photo_url === null || typeof row.photo_url === 'string')) throw new Error('Could not read the published page.');
  const coverMediaId = covers.get(row.page_id) ?? null;
  return { pageId: row.page_id, ownerId: row.owner_id, kind: row.page_kind, name: row.name, purpose: row.purpose,
    city: row.city, description: row.description, photoUrl: coverMediaId ? null : row.photo_url, coverMediaId, publishedAt: row.published_at };
}
async function readPages(ids: string[], scope: PageImageScope): Promise<Map<string, PublishedPageIdentity>> {
  const result = new Map<string, PublishedPageIdentity>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    current(scope); const batch = ids.slice(offset, offset + 100);
    const pages = await supabase.from('creator_page_publications').select(columns).in('page_id', batch); current(scope);
    if (pages.error) throw pages.error;
    const rows = pages.data ?? [];
    if (rows.some(row => !batch.includes(row.page_id))) throw new Error('Could not read the published page.');
    const covers = await getPublishedCoverMediaIds(rows.map(row => row.page_id)); current(scope);
    for (const row of rows) {
      if (result.has(row.page_id)) throw new Error('Duplicate published page identity.');
      result.set(row.page_id, parse(row, batch, covers));
    }
  }
  return result;
}
export async function loadPublishedPageIdentity(pageId: string, scope: PageImageScope) {
  if (!uuid.test(pageId)) throw new Error('This page address is invalid.');
  await checkPublishedPageScope(scope);
  const pages = await readPages([pageId], scope);
  await checkPublishedPageScope(scope);
  return pages.get(pageId) ?? null;
}
/** Missing linkage means legacy. A known page with no visible publication must not fall back to legacy identity. */
export async function loadPublishedEventPageIdentities(eventIds: string[], scope: PageImageScope) {
  const ids = [...new Set(eventIds)];
  if (ids.some(id => !uuid.test(id))) throw new Error('Could not check event pages.');
  await checkPublishedPageScope(scope);
  const links = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    current(scope); const batch = ids.slice(offset, offset + 100);
    const result = await supabase.from('creator_page_events').select('event_id,page_id').in('event_id', batch); current(scope);
    if (result.error) throw result.error;
    for (const row of result.data ?? []) {
      if (!batch.includes(row.event_id) || !uuid.test(row.page_id) || links.has(row.event_id)) throw new Error('Could not check event pages.');
      links.set(row.event_id, row.page_id);
    }
  }
  const pages = await readPages([...new Set(links.values())], scope);
  await checkPublishedPageScope(scope);
  return new Map<string, PublishedEventPageIdentity>([...links].map(([eventId,pageId]) => [eventId, { pageId, page: pages.get(pageId) ?? null }]));
}
/** New links are explicit; old /organization/<accountId> URLs retain their original meaning. */
export function publishedPageRoute(page: Pick<PublishedPageIdentity, 'pageId' | 'kind'>) {
  return page.kind === 'community' ? `/community/${page.pageId}` : `/organization/${page.pageId}?identity=page`;
}
