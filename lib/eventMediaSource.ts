import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';
import { CreatorPageScopeExpired } from './creatorPageReview';
import type { PageImageScope } from './publishedPageCover';

export type EventMediaKind = 'cover' | 'image' | 'poster' | 'video';
export type EventMediaReference = { type: 'legacy'; uri: string } | { type: 'private'; objectName: string } | { type: 'invalid' };
export type ProtectedEventMediaSource = { uri: string; headers: Record<string, string>; useCaching: false };
const prefix = 'creator-event-media:';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const privatePath = new RegExp(`^(${uuid})/private-(${uuid})\\.(jpg|png|webp|mp4)$`);

/** Protected-looking values fail closed, including raw Storage URLs and malformed markers. */
export function isProtectedEventMedia(reference: string): boolean {
  return /creator-event-media|\/private-/i.test(reference);
}

export function eventMediaReference(eventId: string, reference: string, kind: EventMediaKind): EventMediaReference {
  if (!isProtectedEventMedia(reference)) {
    return { type: 'legacy', uri: kind === 'cover' ? reference : supabase.storage.from('event-content').getPublicUrl(reference).data.publicUrl };
  }
  if (kind === 'cover' && !reference.startsWith(prefix)) return { type: 'invalid' };
  const objectName = kind === 'cover' ? reference.slice(prefix.length) : reference;
  const match = privatePath.exec(objectName);
  if (!match || match[1] !== eventId || (kind === 'video' ? match[3] !== 'mp4' : match[3] === 'mp4')) return { type: 'invalid' };
  return { type: 'private', objectName };
}

/** Each native request is authorized by Storage RLS; no signed URL or public fallback. */
export async function loadEventMediaSource(eventId: string, reference: string, kind: EventMediaKind, scope: PageImageScope): Promise<ProtectedEventMediaSource> {
  const parsed = eventMediaReference(eventId, reference, kind);
  if (parsed.type !== 'private') throw new Error('This media is unavailable.');
  const current = () => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };
  current();
  if (scope.userId) {
    const user = await supabase.auth.getUser(); current();
    if (user.error || user.data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
  }
  // Read the token after getUser, which may refresh the session.
  const session = await supabase.auth.getSession(); current();
  if (session.error || (session.data.session?.user.id ?? null) !== scope.userId) throw new CreatorPageScopeExpired();
  const token = scope.userId ? session.data.session?.access_token : SUPABASE_ANON_KEY;
  if (typeof token !== 'string' || !token) throw new CreatorPageScopeExpired();
  return {
    uri: `${SUPABASE_URL}/storage/v1/object/authenticated/creator-event-media/${parsed.objectName}`,
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'Cache-Control': 'no-cache, no-store' },
    useCaching: false,
  };
}
