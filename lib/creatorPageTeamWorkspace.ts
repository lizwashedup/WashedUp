/** Exact published-page event workspace for accepted teammates.
 * Owner review/application reads remain in the existing owner workspace. */
import { supabase } from './supabase';
import { CreatorPageReceiptUnknown, CreatorPageScopeExpired, type CreatorPageScope, type CreatorPageKind } from './creatorPageReview';
import type { CreatorPageEventSummary } from './creatorPageWorkspace';

export interface CreatorPageTeamWorkspace {
  pageId: string;
  kind: CreatorPageKind;
  name: string;
  ownerId: string;
  events: CreatorPageEventSummary[];
}
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const current = (scope: CreatorPageScope) => { if (!scope.isCurrent()) throw new CreatorPageScopeExpired(); };

export async function loadCreatorPageTeamWorkspace(pageId: string, scope: CreatorPageScope): Promise<CreatorPageTeamWorkspace> {
  current(scope);
  if (!uuid(pageId)) throw new CreatorPageReceiptUnknown();
  const { data: { user }, error: accountError } = await supabase.auth.getUser();
  current(scope);
  if (accountError) throw accountError;
  if (user?.id !== scope.userId) throw new CreatorPageScopeExpired();
  const { data, error } = await supabase.rpc('get_creator_page_team_workspace', { p_page_id: pageId });
  current(scope);
  if (error) throw error;
  if (!record(data) || data.page_id !== pageId || !uuid(data.owner_id)
    || !['community', 'organization'].includes(data.page_kind as string) || typeof data.page_name !== 'string'
    || !Array.isArray(data.events)) throw new CreatorPageReceiptUnknown();
  const seen = new Set<string>();
  const events = data.events.map((event: unknown): CreatorPageEventSummary => {
    if (!record(event) || !uuid(event.id) || seen.has(event.id) || typeof event.title !== 'string'
      || (event.image_url != null && typeof event.image_url !== 'string')
      || (event.event_date != null && typeof event.event_date !== 'string')
      || typeof event.category !== 'string' || !['Draft', 'Live', 'Completed', 'Cancelled', 'Archived'].includes(event.status as string)) {
      throw new CreatorPageReceiptUnknown();
    }
    seen.add(event.id);
    return { id: event.id, title: event.title, category: event.category, status: event.status as string,
      ...(event.image_url !== undefined ? { image_url: event.image_url as string | null } : {}),
      ...(event.event_date !== undefined ? { event_date: event.event_date as string | null } : {}) };
  });
  return { pageId, kind: data.page_kind as CreatorPageKind, name: data.page_name, ownerId: data.owner_id, events };
}
