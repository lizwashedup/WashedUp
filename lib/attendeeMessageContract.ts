// Ported from the verified web request/receipt contract. Server RPCs own recipient/cap rules.
import { ESSENTIAL_REASONS, type EssentialReason, type MessageKind, type SeatFilter } from './attendeeMessaging';
export const messageUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AttendeeMessageContent { kind: MessageKind; essentialReason: EssentialReason | null; subject: string; body: string; replyTo: string; audience: SeatFilter & { search: string }; }
export interface AttendeeMessageReview { eventId: string; recipientCount: number; reviewHash: string; channel: 'in_app_push'; providerDeliveryConfirmed: false; }
/** Reject unknown filter values instead of silently widening the audience. */
export function readMessageContent(value: unknown): AttendeeMessageContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!['promotional','essential'].includes(String(r.kind)) || typeof r.subject !== 'string' || typeof r.body !== 'string' || typeof r.replyTo !== 'string') return null;
  if (!r.subject.trim() || !r.body.trim() || [...r.subject.trim()].length > 160 || [...r.body.trim()].length > 5000 || r.replyTo.trim().length > 200) return null;
  if (r.replyTo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.replyTo.trim())) return null;
  if (r.kind === 'essential' ? !(ESSENTIAL_REASONS as readonly unknown[]).includes(r.essentialReason) : r.essentialReason != null) return null;
  const a = r.audience as Record<string, unknown>;
  if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(k => !['search','tier','checkedIn','refunded'].includes(k))) return null;
  if (typeof a.search !== 'string' || (typeof a.tier !== 'string' && a.tier !== null) || !['all','in','out'].includes(String(a.checkedIn)) || !['all','yes','no'].includes(String(a.refunded))) return null;
  return {kind:r.kind as MessageKind,essentialReason:(r.essentialReason ?? null) as EssentialReason | null,subject:r.subject.trim(),body:r.body.trim(),replyTo:r.replyTo.trim(),audience:{search:a.search.trim(),tier:(a.tier ?? '') as string,checkedIn:a.checkedIn as SeatFilter['checkedIn'],refunded:a.refunded as SeatFilter['refunded']}};
}
export function readMessageReview(value: unknown, eventId: string): AttendeeMessageReview | null {
  const r = value as AttendeeMessageReview;
  if (!r || r.eventId !== eventId || !Number.isSafeInteger(r.recipientCount) || r.recipientCount < 0 || typeof r.reviewHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.reviewHash) || r.channel !== 'in_app_push' || r.providerDeliveryConfirmed !== false) return null;
  return r;
}

export interface AttendeeMessageReceipt {
  id: string;
  recipientCount: number;
  deliveryStatus: "queued" | "unconfirmed";
  pushQueuedCount: number | null;
}
/** A successful HTTP status alone never means the provider delivered a message. */
export function readAttendeeMessageReceipt(value: unknown): AttendeeMessageReceipt | null {
  const r = value as AttendeeMessageReceipt;
  if (!r || typeof r.id !== "string" || !r.id || !Number.isSafeInteger(r.recipientCount) || r.recipientCount < 1) return null;
  if (r.deliveryStatus === "queued" && Number.isSafeInteger(r.pushQueuedCount) && r.pushQueuedCount! >= 0 && r.pushQueuedCount! <= r.recipientCount) return r;
  if (r.deliveryStatus === "unconfirmed" && r.pushQueuedCount === null) return r;
  return null;
}

export interface AtomicMessageReceipt extends AttendeeMessageReceipt {
  eventId: string;
  requestId: string;
  createdAt: string;
  providerDeliveryConfirmed: false;
}
export function readAtomicMessageReceipt(value: unknown, eventId: string, requestId: string): AtomicMessageReceipt | null {
  const r = readAttendeeMessageReceipt(value) as AtomicMessageReceipt | null;
  if (!r || !messageUuid.test(r.id) || r.eventId !== eventId || r.requestId !== requestId || r.providerDeliveryConfirmed !== false || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) return null;
  if (r.deliveryStatus === 'queued' && r.pushQueuedCount !== r.recipientCount) return null;
  return r;
}
