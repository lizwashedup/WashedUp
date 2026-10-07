import { supabase } from './supabase';
import { scopedTicketRequest } from './creatorTicketRead';
import type { CreatorPageScope } from './creatorPageReview';
import { messageUuid, readAtomicMessageReceipt, type AtomicMessageReceipt } from './attendeeMessageContract';
import { validInvitationDraft, type EventInvitation, type InvitationDraft } from './eventInvitation';

export interface InvitationReview {
  context: Omit<EventInvitation, 'audiences' | 'deliveryReady'>;
  message: InvitationDraft;
  recipientCount: number;
  reviewHash: string;
  channel: 'in_app_push';
  providerDeliveryConfirmed: false;
  sendingEnabled: boolean;
}
export interface InvitationReceipt extends AtomicMessageReceipt { pageId: string }
export class InvitationRejected extends Error {}

export function invitationContent(value: unknown): InvitationDraft | null {
  if (!validInvitationDraft(value) || Array.isArray(value) || !value.body.trim()
    || Object.keys(value).some(k => !['audience','body'].includes(k))) return null;
  return { audience: value.audience, body: value.body.trim() };
}
export function readInvitationReview(value: unknown, eventId: string, message: InvitationDraft): InvitationReview | null {
  const r = value as InvitationReview, c = r?.context, content = invitationContent(r?.message), expected = invitationContent(message);
  if (!r || !c || c.eventId !== eventId || !messageUuid.test(c.eventId) || !messageUuid.test(c.pageId)
    || typeof c.eventTitle !== 'string' || !c.eventTitle.trim() || typeof c.pageName !== 'string' || !c.pageName.trim()
    || !['community','organization'].includes(c.pageKind) || typeof c.eventStatus !== 'string'
    || !(c.eventImage === null || typeof c.eventImage === 'string')
    || !content || !expected || content.body !== expected.body || content.audience !== expected.audience
    || !(content.audience === 'past_attendees' || content.audience === (c.pageKind === 'community' ? 'community_members' : 'followers'))
    || !Number.isSafeInteger(r.recipientCount) || r.recipientCount < 0
    || typeof r.reviewHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.reviewHash)
    || r.channel !== 'in_app_push' || r.providerDeliveryConfirmed !== false || typeof r.sendingEnabled !== 'boolean') return null;
  return { ...r, message: content };
}
function readReceipt(value: unknown, eventId: string, pageId: string, requestId: string): InvitationReceipt | null {
  const r = readAtomicMessageReceipt(value,eventId,requestId) as InvitationReceipt | null;
  return r && r.pageId === pageId && messageUuid.test(r.pageId) && r.deliveryStatus === 'queued' ? r : null;
}
export async function reviewEventInvitation(eventId: string, message: InvitationDraft, scope: CreatorPageScope) {
  const content = invitationContent(message);
  if (!messageUuid.test(eventId) || !content) throw Error('Check the invitation before reviewing.');
  const { data,error } = await scopedTicketRequest(scope,()=>supabase.rpc('review_event_invitation',{p_event_id:eventId,p_message:content}));
  if (error) throw Error('The invitation could not be reviewed. Your draft is kept.');
  const review = readInvitationReview(data,eventId,content);
  if (!review) throw Error('The invitation review could not be confirmed.');
  return review;
}
export async function readEventInvitationStatus(eventId: string, pageId: string, requestId: string, scope: CreatorPageScope) {
  if (![eventId,pageId,requestId].every(id=>messageUuid.test(id))) throw Error('Invalid invitation reference.');
  const { data,error } = await scopedTicketRequest(scope,()=>supabase.rpc('get_event_invitation_receipt',{p_request_id:requestId}));
  if (error) throw Error('Invitation status could not be checked. Your original request is kept.');
  if (data === null) return null;
  const receipt = readReceipt(data,eventId,pageId,requestId);
  if (!receipt) throw Error('Invitation status did not match this request.');
  return receipt;
}
export async function submitEventInvitation(eventId: string, pageId: string, requestId: string, review: InvitationReview, scope: CreatorPageScope) {
  const checked = readInvitationReview(review,eventId,review.message);
  if (!checked || checked.context.pageId !== pageId || !messageUuid.test(requestId) || !checked.sendingEnabled || checked.recipientCount < 1) throw Error('Review this invitation before sending.');
  const { data,error } = await scopedTicketRequest(scope,()=>supabase.rpc('submit_event_invitation',{
    p_event_id:eventId,p_request_id:requestId,p_message:checked.message,p_review_hash:checked.reviewHash,
  }));
  if (error) {
    // Only these rejections follow the locked existing-receipt lookup. Other failures stay uncertain.
    if (error.code === 'P0001' && ['Invitation sending is unavailable','Publish an upcoming event before inviting people',
      'Invitation page changed; review again','No recipients match this invitation','Invitation or audience changed; review again','Page invitation limit reached'].includes(error.message)) {
      throw new InvitationRejected(error.message);
    }
    throw Error('Sending could not be confirmed. Check the saved request before sending again.');
  }
  const receipt = readReceipt(data,eventId,pageId,requestId);
  if (!receipt) throw Error('Sending could not be confirmed. Check the saved request before sending again.');
  return receipt;
}
