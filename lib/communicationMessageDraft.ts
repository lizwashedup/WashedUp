import { EMPTY_FILTER, ESSENTIAL_REASONS, MESSAGE_BODY_MAX, MESSAGE_SUBJECT_MAX, type EssentialReason, type MessageKind, type SeatFilter } from './attendeeMessaging';
export interface CommunicationMessageDraft {
  subject: string; body: string; replyTo: string; audience: SeatFilter; kind: MessageKind; essentialReason: EssentialReason | null;
}
export const EMPTY_MESSAGE_DRAFT: CommunicationMessageDraft = {
  subject: '', body: '', replyTo: '', audience: EMPTY_FILTER, kind: 'promotional', essentialReason: null,
};
export function validCommunicationMessageDraft(value: unknown): value is CommunicationMessageDraft {
  const d = value as CommunicationMessageDraft;
  return !!d && typeof d.subject === 'string' && d.subject.length <= MESSAGE_SUBJECT_MAX && typeof d.body === 'string' && d.body.length <= MESSAGE_BODY_MAX
    && typeof d.replyTo === 'string' && d.replyTo.length <= 200 && ['promotional', 'essential'].includes(d.kind)
    && (d.essentialReason === null || ESSENTIAL_REASONS.includes(d.essentialReason)) && !!d.audience
    && (d.audience.tier === null || typeof d.audience.tier === 'string') && ['all', 'in', 'out'].includes(d.audience.checkedIn)
    && ['all', 'yes', 'no'].includes(d.audience.refunded);
}
export function messageDraftProblem(d: CommunicationMessageDraft): string | null {
  if (!d.subject.trim() || !d.body.trim()) return 'Add a subject and message before reviewing.';
  if (d.kind === 'essential' && !d.essentialReason) return 'Choose the reason for this essential update.';
  if (d.replyTo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.replyTo.trim())) return 'Check the reply email address.';
  return null;
}
export function describeMessageExclusions(filter: SeatFilter): string {
  const parts: string[] = [];
  if (filter.checkedIn === 'in') parts.push('not-yet-checked-in guests');
  if (filter.checkedIn === 'out') parts.push('already-checked-in guests');
  if (filter.refunded === 'no') parts.push('refunded guests');
  if (filter.refunded === 'yes') parts.push('non-refunded guests');
  if (filter.tier) parts.push(`everyone outside “${filter.tier}”`);
  if (parts.length) parts.push('RSVPs without tickets');
  return parts.length ? parts.join(', ') : 'No registration filters applied';
}
