import { supabase } from './supabase';
import type { CreatorPageScope } from './creatorPageReview';
import { scopedTicketRequest } from './creatorTicketRead';
import type { InviteAudienceType } from './inviteAudience';

export interface InvitationAudience { type: InviteAudienceType; sourceCount: number; excludedCount: number; eligibleCount: number }
export interface EventInvitation {
  eventId: string; eventTitle: string; eventImage: string | null; eventStatus: string;
  pageId: string; pageName: string; pageKind: 'community' | 'organization';
  audiences: InvitationAudience[]; deliveryReady: false;
}
export interface InvitationDraft { audience: InviteAudienceType; body: string }
export const EMPTY_INVITATION: InvitationDraft = { audience: 'past_attendees', body: '' };
const types: InviteAudienceType[] = ['past_attendees', 'followers', 'community_members'];
export const invitationAudienceLabel = (type: InviteAudienceType) => ({past_attendees: 'Past attendees', followers: 'Page followers', community_members: 'Community members'})[type];
export function validInvitationDraft(value: unknown): value is InvitationDraft {
  const d = value as InvitationDraft;
  return !!d && types.includes(d.audience) && typeof d.body === 'string' && d.body.length <= 2000;
}
export function parseEventInvitation(value: unknown, eventId: string): EventInvitation {
  const d = value as EventInvitation;
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!d || d.eventId !== eventId || typeof d.eventTitle !== 'string' || !d.eventTitle.trim()
    || typeof d.pageId !== 'string' || !d.pageId || typeof d.pageName !== 'string' || !d.pageName.trim()
    || !['community','organization'].includes(d.pageKind) || typeof d.eventStatus !== 'string'
    || !(d.eventImage === null || typeof d.eventImage === 'string') || d.deliveryReady !== false
    || !Array.isArray(d.audiences) || d.audiences.length !== 2
    || !d.audiences.every(a => a && types.includes(a.type) && integer(a.sourceCount) && integer(a.excludedCount)
      && integer(a.eligibleCount) && a.excludedCount + a.eligibleCount === a.sourceCount)
    || new Set(d.audiences.map(a => a.type)).size !== 2 || !d.audiences.some(a => a.type === 'past_attendees')
    || !d.audiences.some(a => a.type === (d.pageKind === 'organization' ? 'followers' : 'community_members'))) {
    throw Error('The invitation audience could not be checked.');
  }
  return d;
}
/** Account-pinned aggregate RPC; never fetches private recipient rosters into the client. */
export async function getEventInvitation(eventId: string, scope: CreatorPageScope): Promise<EventInvitation> {
  const { data, error } = await scopedTicketRequest(scope, () => supabase.rpc('preview_event_invitation', {p_event_id: eventId}));
  if (error) throw error;
  return parseEventInvitation(data, eventId);
}
