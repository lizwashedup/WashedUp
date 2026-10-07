import {supabase} from './supabase';
import {CreatorPageScopeExpired, type CreatorPageScope} from './creatorPageReview';
import {mediaUUID} from './creatorPageEventMedia';
import type {EventTemplate} from './creatorEvents';

export interface PageEventLibraryTemplate extends EventTemplate {
  user_id: string; source_page_id: string | null; source_event_id: string | null; source_updated_at: string | null;
}
async function account(scope: CreatorPageScope) {
  if (!scope.isCurrent() || !mediaUUID(scope.userId)) throw new CreatorPageScopeExpired();
  const {data, error} = await supabase.auth.getUser();
  if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
  if (error) throw error; if (data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
}
export async function listCreatorEventTemplates(scope: CreatorPageScope): Promise<PageEventLibraryTemplate[]> {
  await account(scope);
  const {data, error} = await supabase.from('operator_event_templates')
    .select('id,user_id,name,community_id,fields,created_at,source_page_id,source_event_id,source_updated_at')
    .eq('user_id', scope.userId).order('created_at', {ascending: false});
  await account(scope); if (error) throw error;
  if (!Array.isArray(data) || !data.every(t => mediaUUID(t.id) && t.user_id === scope.userId && typeof t.name === 'string'
    && t.fields && typeof t.fields === 'object' && !Array.isArray(t.fields)
    && (t.source_page_id === null && t.source_event_id === null && t.source_updated_at === null
      || mediaUUID(t.source_page_id) && mediaUUID(t.source_event_id) && typeof t.source_updated_at === 'string' && Number.isFinite(Date.parse(t.source_updated_at))))) throw Error('Could not confirm this template library.');
  return data as PageEventLibraryTemplate[];
}
export function creatorTemplateRoute(template: EventTemplate | PageEventLibraryTemplate) {
  if ('source_page_id' in template && template.source_page_id) {
    if (!mediaUUID(template.source_page_id) || !mediaUUID(template.source_event_id) || !mediaUUID(template.id)) throw Error('Check the saved source template.');
    return `/creator/page-event-reuse?pageId=${template.source_page_id}&sourceEventId=${template.source_event_id}&templateId=${template.id}`;
  }
  return `/creator/event-form?templateId=${template.id}`;
}
/** A source-page template remains personally owned. Its author may explicitly
 * delete it after source revocation without reading private source content. */
export async function deleteCreatorEventTemplate(selected: PageEventLibraryTemplate, scope: CreatorPageScope) {
  const t = {...selected}; await account(scope);
  if (!mediaUUID(t.id) || t.user_id !== scope.userId) throw Error('Check this template’s owner.');
  if (t.source_page_id) {
    const {data, error} = await supabase.rpc('delete_creator_page_event_template', {p_template_id: t.id});
    await account(scope); if (error) throw error;
    if (data !== t.id) throw Error('The template deletion is unconfirmed. Check the library.');
  } else {
    const {data, error} = await supabase.from('operator_event_templates').delete().eq('id', t.id).eq('user_id', scope.userId).select('id');
    await account(scope); if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1 || data[0].id !== t.id) throw Error('The template deletion is unconfirmed. Check the library.');
  }
}
