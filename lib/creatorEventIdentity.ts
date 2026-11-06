import { supabase } from './supabase';
import type { CreatorPageScope } from './creatorPageReview';
import { mediaUUID } from './creatorPageEventMedia';
import { loadManagedOrganizationName } from './creatorManagement';
import { scopedTicketRequest as readEvent } from './creatorTicketRead';
import { requestWithDeadline } from './requestWithDeadline';

// An event's public listing name is editable. Its organizer comes from its saved owner.
export function loadSavedEventOrganizer(eventId: string, scope: CreatorPageScope): Promise<string> {
  // The label is optional. Bound the full read, including session lookup.
  return requestWithDeadline(readSavedOrganizer(eventId, scope), 9000);
}

async function readSavedOrganizer(eventId: string, scope: CreatorPageScope): Promise<string> {
  if (!mediaUUID(eventId)) throw Error('Organizer unavailable');
  const result = await readEvent(scope, () => supabase.from('explore_events')
    .select('id,owner_type,owner_user_id,owner_community_id').eq('id', eventId).maybeSingle(), 6000);
  const owner = result.data;
  if (result.error || owner?.id !== eventId) throw Error('Organizer unavailable');
  if (owner.owner_type === 'platform') return 'WashedUp';
  if (owner.owner_type === 'organization' && mediaUUID(owner.owner_user_id)) {
    if (owner.owner_user_id !== scope.userId) return 'Organization event';
    return await loadManagedOrganizationName(scope) ?? 'Your organization';
  }
  if (owner.owner_type === 'community' && mediaUUID(owner.owner_community_id)) {
    const community = await readEvent(scope, () => supabase.from('communities')
      .select('id,name').eq('id', owner.owner_community_id).maybeSingle(), 6000);
    if (!community.error && community.data?.id === owner.owner_community_id) {
      return community.data.name?.trim() || 'Community event';
    }
    return 'Community event';
  }
  throw Error('Organizer unavailable');
}
