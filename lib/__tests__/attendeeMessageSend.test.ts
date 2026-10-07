const mockRpc = jest.fn(), mockResult = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock('../creatorTicketRead', () => ({ scopedTicketRequest: (_s: unknown, make: () => unknown) => { make(); return mockResult(); } }));
import { messageContent, reviewAttendeeMessage, submitAttendeeMessage, readAttendeeMessageStatus, AttendeeMessageRejected } from '../attendeeMessageSend';
import { EMPTY_MESSAGE_DRAFT } from '../communicationMessageDraft';
const event = '22222222-2222-4222-8222-222222222222', request = '33333333-3333-4333-8333-333333333333';
const scope = { userId: 'member', isCurrent: () => true };
const content = messageContent({ ...EMPTY_MESSAGE_DRAFT, subject: 'Sunday', body: 'Meet here' })!;
const review = { eventId: event, recipientCount: 2, reviewHash: 'a'.repeat(64), channel: 'in_app_push', providerDeliveryConfirmed: false };
const receipt = { id: '44444444-4444-4444-8444-444444444444', eventId: event, requestId: request, recipientCount: 2, pushQueuedCount: 2, deliveryStatus: 'queued', createdAt: '2026-09-16T17:00:00Z', providerDeliveryConfirmed: false };
beforeEach(() => { jest.clearAllMocks(); });
it('uses server recipient review, with no client recipient list', async () => {
  mockResult.mockResolvedValue({ data: review, error: null });
  expect(await reviewAttendeeMessage(event, content, scope)).toEqual(review);
  expect(mockRpc).toHaveBeenCalledWith('preview_attendee_message', { p_event_id: event, p_message: content });
});
it.each([{ ...review, eventId: request }, { ...review, recipientCount: 0 }, { ...review, providerDeliveryConfirmed: true }])('rejects invalid, empty or misdirected review %p', async data => {
  mockResult.mockResolvedValue({ data, error: null }); await expect(reviewAttendeeMessage(event, content, scope)).rejects.toThrow();
});
it('submits only the saved request, content and reviewed audience hash', async () => {
  mockResult.mockResolvedValue({ data: receipt, error: null }); expect(await submitAttendeeMessage(event, request, content, review.reviewHash, scope)).toEqual(receipt);
  expect(mockRpc).toHaveBeenCalledWith('submit_attendee_message', { p_event_id: event, p_request_id: request, p_message: content, p_review_hash: review.reviewHash });
});
it.each([{ ...receipt, eventId: request }, { ...receipt, requestId: event }, { ...receipt, pushQueuedCount: 1 }, { ...receipt, providerDeliveryConfirmed: true }, null])('does not treat invalid/partial queue receipt as success %p', async data => {
  mockResult.mockResolvedValue({ data, error: null }); await expect(submitAttendeeMessage(event, request, content, review.reviewHash, scope)).rejects.toThrow('could not be confirmed');
});
it('distinguishes locked transaction rejection from permission/network uncertainty', async () => {
  mockResult.mockResolvedValueOnce({ error: { code: 'P0001', message: 'Message or audience changed; review again' } });
  await expect(submitAttendeeMessage(event, request, content, review.reviewHash, scope)).rejects.toBeInstanceOf(AttendeeMessageRejected);
  mockResult.mockResolvedValueOnce({ error: { code: 'P0001', message: 'Event communication access denied' } });
  await expect(submitAttendeeMessage(event, request, content, review.reviewHash, scope)).rejects.not.toBeInstanceOf(AttendeeMessageRejected);
});
it('status only reads the original request and preserves null as not-yet-recorded', async () => {
  mockResult.mockResolvedValueOnce({ data: null, error: null }); expect(await readAttendeeMessageStatus(event, request, scope)).toBeNull();
  expect(mockRpc).toHaveBeenCalledWith('get_attendee_message_receipt', { p_request_id: request });
});
