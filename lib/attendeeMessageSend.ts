import { supabase } from './supabase';
import { scopedTicketRequest } from './creatorTicketRead';
import type { CreatorPageScope } from './creatorPageReview';
import type { CommunicationMessageDraft } from './communicationMessageDraft';
import { messageUuid, readMessageContent, readMessageReview, readAtomicMessageReceipt, type AttendeeMessageContent } from './attendeeMessageContract';

export function messageContent(draft: CommunicationMessageDraft): AttendeeMessageContent | null {
  return readMessageContent({ ...draft, audience: { ...draft.audience, search: '' } });
}
export class AttendeeMessageRejected extends Error {}

export async function reviewAttendeeMessage(eventId: string, message: AttendeeMessageContent, scope: CreatorPageScope) {
  const content = readMessageContent(message);
  if (!messageUuid.test(eventId) || !content) throw Error('Check the message and audience before reviewing.');
  const { data, error } = await scopedTicketRequest(scope, () => supabase.rpc('preview_attendee_message', { p_event_id: eventId, p_message: content }));
  if (error) throw Error('The audience could not be checked. Your draft is kept.');
  const review = readMessageReview(data, eventId);
  if (!review) throw Error('The audience review could not be confirmed.');
  if (review.recipientCount < 1) throw Error('No one matches this audience. Adjust the filters before sending.');
  return review;
}

export async function readAttendeeMessageStatus(eventId: string, requestId: string, scope: CreatorPageScope) {
  if (!messageUuid.test(eventId) || !messageUuid.test(requestId)) throw Error('Invalid message reference.');
  const { data, error } = await scopedTicketRequest(scope, () => supabase.rpc('get_attendee_message_receipt', { p_request_id: requestId }));
  if (error) throw Error('Message status could not be checked.');
  if (data === null) return null;
  const receipt = readAtomicMessageReceipt(data, eventId, requestId);
  if (!receipt) throw Error('Message status did not match this request.');
  return receipt;
}

export async function submitAttendeeMessage(eventId: string, requestId: string, message: AttendeeMessageContent, reviewHash: string, scope: CreatorPageScope) {
  const content = readMessageContent(message);
  if (!messageUuid.test(eventId) || !messageUuid.test(requestId) || !/^[0-9a-f]{64}$/.test(reviewHash) || !content) throw Error('Review this message before sending.');
  const { data, error } = await scopedTicketRequest(scope, () => supabase.rpc('submit_attendee_message', {
    p_event_id: eventId, p_request_id: requestId, p_message: content, p_review_hash: reviewHash,
  }));
  if (error) {
    // These explicit rejections occur after the request lock and existing-receipt lookup.
    // Permission/transport/mismatched-key errors cannot prove an earlier request unrecorded.
    if (error.code === 'P0001' && ['Message or audience changed; review again', 'No recipients match this audience', 'attendee message daily cap reached'].includes(error.message)) {
      throw new AttendeeMessageRejected(error.message);
    }
    throw Error('Recording could not be confirmed. Check this saved request before sending again.');
  }
  const receipt = readAtomicMessageReceipt(data, eventId, requestId);
  if (!receipt) throw Error('Recording could not be confirmed. Check this saved request before sending again.');
  return receipt;
}
