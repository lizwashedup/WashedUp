/** Public-page media still uses audience-authorized authenticated Storage reads. */
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { CreatorPageScopeExpired } from './creatorPageReview';
export interface PageImageScope { userId: string | null; isCurrent(): boolean; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const current = (scope: PageImageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
async function sessionFor(scope: PageImageScope) {
  current(scope);
  const session = await supabase.auth.getSession(); current(scope);
  if (session.error || (session.data.session?.user.id ?? null) !== scope.userId) throw new CreatorPageScopeExpired();
  if (scope.userId) {
    const user = await supabase.auth.getUser(); current(scope);
    if (user.error || user.data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
  }
  return session.data.session;
}
/** Only enrich the already-authorized directory rows; no private draft reads or URL conversion. */
export async function getPublishedCoverMediaIds(pageIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(pageIds)];
  if (!ids.length) return new Map();
  if (ids.some(id => !uuid.test(id))) throw new Error('Could not check page covers.');
  const { data, error } = await supabase.from('creator_page_cover_publications').select('page_id,media_id').in('page_id', ids);
  if (error) throw error;
  const result = new Map<string, string>();
  for (const row of data ?? []) {
    if (!ids.includes(row.page_id) || !uuid.test(row.media_id)) throw new Error('Could not check page covers.');
    result.set(row.page_id, row.media_id);
  }
  return result;
}
/** Resolve the publication first, even for its owner/reviewer who can also read private media. */
export async function loadPublishedPageCoverSource(pageId: string, mediaId: string, scope: PageImageScope) {
  if (!uuid.test(pageId) || !uuid.test(mediaId)) throw new Error('This cover is unavailable.');
  await sessionFor(scope);
  const publication = await supabase.from('creator_page_cover_publications').select('page_id,media_id').eq('page_id', pageId).maybeSingle(); current(scope);
  if (publication.error) throw publication.error;
  if (publication.data?.page_id !== pageId || publication.data.media_id !== mediaId) throw new Error('This published cover is unavailable.');
  const media = await supabase.from('creator_page_media').select('id,page_id,object_name,mime_type,ready_at').eq('id', mediaId).eq('page_id', pageId).maybeSingle(); current(scope);
  if (media.error) throw media.error;
  const row = media.data;
  if (!row || row.id !== mediaId || row.page_id !== pageId || !row.ready_at || !['image/jpeg', 'image/png'].includes(row.mime_type)
    || row.object_name !== `${pageId}/${mediaId}.${row.mime_type === 'image/jpeg' ? 'jpg' : 'png'}`) throw new Error('This cover is unavailable.');
  const session = await sessionFor(scope);
  return { uri: `${SUPABASE_URL}/storage/v1/object/authenticated/creator-page-media/${row.object_name}`,
    headers: { Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY } };
}
/** Protected references take precedence; never replace a failed protected cover with a legacy URL. */
export function communityCoverReference(content: Record<string, unknown> | null | undefined) {
  const mediaId = typeof content?.cover_media_id === 'string' && content.cover_media_id ? content.cover_media_id : null;
  const images = !mediaId && Array.isArray(content?.images) ? content.images.filter((image): image is string => typeof image === 'string' && !!image) : [];
  return { mediaId, images, hasCover: !!mediaId || images.length > 0 };
}
