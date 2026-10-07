/** Resolve existing creator links without guessing that an RLS-hidden page
 * association means an ordinary event. Does not create or save anything. */
import {supabase} from './supabase';
import {CreatorPageScopeExpired, type CreatorPageScope} from './creatorPageReview';
import {mediaUUID} from './creatorPageEventMedia';
import {getPageEventReuseWorkspace} from './creatorPageEventReuseEntry';

export type CreatorEventEntryIntent = {kind: 'edit' | 'duplicate' | 'template'; id: string};
export type CreatorEventEntry = {kind: 'ordinary'} | {kind: 'page'; pageId: string; eventId: string; entry: 'owner' | 'team'; templateId?: string};
async function account(scope: CreatorPageScope) {
  if (!scope.isCurrent() || !mediaUUID(scope.userId)) throw new CreatorPageScopeExpired();
  const {data, error} = await supabase.auth.getUser();
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  if (error) throw error; if (data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
}
export async function resolveCreatorEventEntry(selected: CreatorEventEntryIntent, scope: CreatorPageScope): Promise<CreatorEventEntry> {
  const intent = {...selected}; await account(scope);
  if (!['edit', 'duplicate', 'template'].includes(intent.kind) || !mediaUUID(intent.id)) throw Error('Check this event link.');
  let pageId: string | undefined, eventId = intent.id;
  if (intent.kind === 'template') {
    const {data, error} = await supabase.from('operator_event_templates')
      .select('id,user_id,source_page_id,source_event_id,source_updated_at').eq('id', intent.id).eq('user_id', scope.userId).maybeSingle();
    await account(scope); if (error) throw error;
    if (!data || data.id !== intent.id || data.user_id !== scope.userId) throw Error('This template is unavailable for this account.');
    if (data.source_page_id === null && data.source_event_id === null && data.source_updated_at === null) return {kind: 'ordinary'};
    if (!mediaUUID(data.source_page_id) || !mediaUUID(data.source_event_id) || typeof data.source_updated_at !== 'string' || !Number.isFinite(Date.parse(data.source_updated_at))) throw Error('Check this template’s saved source.');
    pageId = data.source_page_id; eventId = data.source_event_id;
  } else {
    const event = await supabase.from('explore_events').select('id').eq('id', eventId).maybeSingle();
    await account(scope); if (event.error) throw event.error;
    if (!event.data || event.data.id !== eventId) throw Error('This event is unavailable for this account.');
    const link = await supabase.from('creator_page_events').select('page_id,event_id').eq('event_id', eventId).maybeSingle();
    await account(scope); if (link.error) throw link.error;
    if (link.data) {
      if (link.data.event_id !== eventId || !mediaUUID(link.data.page_id)) throw Error('Check this event’s page.');
      pageId = link.data.page_id;
    } else {
      // Existing association SELECT includes every creator-visible event. A
      // false/unknown predicate cannot establish absence (e.g. private admin
      // access or revoked page permission), so it must not fall through.
      const visible = await supabase.rpc('creator_event_is_visible', {p_event_id: eventId});
      await account(scope); if (visible.error) throw visible.error;
      if (visible.data !== true) throw Error('Could not confirm this event’s page access.');
      // Re-read after the predicate. Page creation binds its event atomically;
      // no authorized creator operation moves an existing event between pages.
      const confirmed = await supabase.from('creator_page_events').select('page_id,event_id').eq('event_id', eventId).maybeSingle();
      await account(scope); if (confirmed.error) throw confirmed.error;
      if (!confirmed.data) return {kind: 'ordinary'};
      if (confirmed.data.event_id !== eventId || !mediaUUID(confirmed.data.page_id)) throw Error('Check this event’s page.');
      pageId = confirmed.data.page_id;
    }
  }
  const page = await getPageEventReuseWorkspace(pageId, scope); await account(scope);
  if (!page.events.some(e => e.id === eventId)) throw Error('This event is unavailable for this page.');
  return {kind: 'page', pageId, eventId, entry: page.entry, ...(intent.kind === 'template' ? {templateId: intent.id} : {})};
}
export function creatorEventEntryRoute(intent: CreatorEventEntryIntent, resolved: Exclude<CreatorEventEntry, {kind: 'ordinary'}>, options: {openPhotos?: boolean; returnToTickets?: boolean} = {}) {
  if (intent.kind === 'edit') return `/creator/event-form?id=${resolved.eventId}&pageId=${resolved.pageId}${resolved.entry === 'team' ? '&team=1' : ''}${options.openPhotos ? '&openPhotos=1' : ''}${options.returnToTickets ? '&returnToTickets=1' : ''}`;
  return `/creator/page-event-reuse?pageId=${resolved.pageId}&sourceEventId=${resolved.eventId}${resolved.templateId ? `&templateId=${resolved.templateId}` : ''}`;
}
