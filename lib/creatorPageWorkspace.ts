/** Owned, read-only page workspace. Reuses the review records and real events. */
import { supabase } from './supabase';
import { loadCreatorPageReview, CreatorPageReceiptUnknown, CreatorPageScopeExpired,
  type CreatorPageScope, type CreatorPageDraft, type CreatorPagePublication } from './creatorPageReview';

async function check(scope: CreatorPageScope) {
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!scope.isCurrent() || user?.id !== scope.userId) throw new CreatorPageScopeExpired();
  if (error) throw error;
}
function current(scope: CreatorPageScope) {
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
}
export interface CreatorPageEventSummary {
  id: string; title: string; status: string; category: string;
  image_url?: string | null; event_date?: string | null;
}
export type CreatorPageListEntry = CreatorPageDraft & { published_data?: Record<string, unknown> };
export async function listCreatorPages(scope: CreatorPageScope): Promise<CreatorPageListEntry[]> {
  await check(scope);
  const result = await supabase.from('creator_page_drafts')
    .select('id,owner_id,page_kind,page_data,version,created_at,updated_at')
    .eq('owner_id', scope.userId).order('updated_at', { ascending: false });
  current(scope);
  if (result.error) throw result.error;
  if (!Array.isArray(result.data) || !result.data.every(row => row.owner_id === scope.userId
    && typeof row.id === 'string' && ['community', 'organization'].includes(row.page_kind)
    && row.page_data && typeof row.page_data === 'object' && !Array.isArray(row.page_data)
    && Number.isInteger(row.version) && row.version > 0)) throw new CreatorPageReceiptUnknown();
  const drafts = result.data as CreatorPageDraft[];
  if (!drafts.length) return drafts;
  const ids = drafts.map(row => row.id);
  const publications = await supabase.from('creator_page_publications')
    .select('page_id,owner_id,page_kind,name,purpose,city,description,photo_url,audience').in('page_id', ids).eq('owner_id', scope.userId);
  current(scope);
  if (publications.error) throw publications.error;
  if (!Array.isArray(publications.data) || new Set(publications.data.map(row => row.page_id)).size !== publications.data.length
    || !publications.data.every(row => row.owner_id === scope.userId && drafts.some(draft => draft.id === row.page_id && draft.page_kind === row.page_kind)
      && typeof row.name === 'string' && typeof row.purpose === 'string' && typeof row.city === 'string')) throw new CreatorPageReceiptUnknown();
  if (!publications.data.length) return drafts;
  const publishedIds = publications.data.map(row => row.page_id);
  const covers = await supabase.from('creator_page_cover_publications').select('page_id,media_id').in('page_id', publishedIds);
  current(scope);
  if (covers.error) throw covers.error;
  if (!Array.isArray(covers.data) || new Set(covers.data.map(row => row.page_id)).size !== covers.data.length
    || !covers.data.every(row => publishedIds.includes(row.page_id) && typeof row.media_id === 'string')) throw new CreatorPageReceiptUnknown();
  await check(scope);
  return drafts.map(draft => {
    const published = publications.data.find(row => row.page_id === draft.id);
    return published ? { ...draft, published_data: { ...published, cover_media_id: covers.data.find(row => row.page_id === draft.id)?.media_id ?? null } } : draft;
  });
}
export async function loadCreatorPageWorkspace(pageId: string, scope: CreatorPageScope) {
  const review = await loadCreatorPageReview(pageId, scope);
  if (!review) return null;
  const publication = await supabase.from('creator_page_publications')
    .select('page_id,submission_id,owner_id,page_kind,name,purpose,city,description,photo_url,audience,published_at')
    .eq('page_id', pageId).maybeSingle();
  current(scope);
  if (publication.error) throw publication.error;
  const pub = publication.data;
  if (pub && (pub.page_id !== pageId || pub.owner_id !== scope.userId
    || pub.page_kind !== review.draft.page_kind || typeof pub.published_at !== 'string'
    || !review.submissions.some(s => s.id === pub.submission_id && s.status === 'approved'))) {
    throw new CreatorPageReceiptUnknown();
  }
  let publishedCoverMediaId: string | null = null;
  if (pub) {
    const cover = await supabase.from('creator_page_cover_publications').select('page_id,media_id').eq('page_id', pageId).maybeSingle();
    current(scope);
    if (cover.error) throw cover.error;
    if (cover.data && (cover.data.page_id !== pageId || typeof cover.data.media_id !== 'string')) throw new CreatorPageReceiptUnknown();
    publishedCoverMediaId = cover.data?.media_id ?? null;
  }
  const links = await supabase.from('creator_page_events').select('page_id,event_id').eq('page_id', pageId);
  current(scope);
  if (links.error) throw links.error;
  if (!Array.isArray(links.data) || !links.data.every(row => row.page_id === pageId && typeof row.event_id === 'string')) {
    throw new CreatorPageReceiptUnknown();
  }
  let events: CreatorPageEventSummary[] = [];
  if (links.data.length) {
    const ids = links.data.map(row => row.event_id);
    const result = await supabase.from('explore_events').select('id,title,status,category,image_url,event_date')
      .in('id', ids).order('created_at', { ascending: false });
    current(scope);
    if (result.error) throw result.error;
    if (!Array.isArray(result.data) || result.data.length !== ids.length
      || !result.data.every(row => ids.includes(row.id) && typeof row.title === 'string'
        && typeof row.status === 'string' && typeof row.category === 'string'
        && (row.image_url == null || typeof row.image_url === 'string')
        && (row.event_date == null || typeof row.event_date === 'string'))) throw new CreatorPageReceiptUnknown();
    events = result.data;
  }
  return { ...review, publication: pub as CreatorPagePublication | null, publishedCoverMediaId, events };
}
export type CreatorPageWorkspace = NonNullable<Awaited<ReturnType<typeof loadCreatorPageWorkspace>>>;

/** Initial approval permits content editing; publication remains a separate explicit action. */
export function creatorPagePhase(page: CreatorPageWorkspace) {
  const latest = page.submissions[0];
  if (page.publication) return 'published';
  if (!latest) return 'draft';
  if (latest.status === 'submitted') return 'submitted';
  if (latest.status === 'approved') return 'approved';
  if (latest.draft_version !== page.draft.version) return 'changed';
  return latest.status;
}
