import type { CreatorAccess } from './creatorMode';
import type { OperatorEventRow } from './creatorEvents';

/** Presentation permission for this event; database policies remain authoritative. */
export function eventSummaryAccess(event: Pick<OperatorEventRow, 'community_id' | 'host_user_id'> | null | undefined, access: CreatorAccess | null | undefined, viewerId: string | null | undefined) {
  if (!event || !access || !viewerId) return { events: false, finance: false };
  if (event.community_id) {
    const role = access.ledCommunities.find(item => item.id === event.community_id)?.role;
    const admin = role === 'leader' || role === 'co_leader' || role === 'admin';
    return { events: admin || role === 'events', finance: admin || role === 'finance' };
  }
  const own = event.community_id === null && event.host_user_id === viewerId && access.hasEventHostGrant;
  return { events: own, finance: own };
}

export function eventSummaryId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function laDay(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
}

export function summaryStatusLine(status: string, eventDate: string, nowISO: string = new Date().toISOString()): string {
  const normalized = status.trim().toLowerCase();
  if (['cancelled', 'archived', 'completed', 'draft'].includes(normalized)) return normalized;
  const today = laDay(nowISO);
  return /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && today && eventDate < today ? 'ended' : 'scheduled';
}

export function eventSummaryDate(eventDate: string, startTime: string | null): string {
  if (startTime && Number.isFinite(Date.parse(startTime))) {
    return new Date(startTime).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return 'Date to be set';
  const date = new Date(`${eventDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== eventDate) return 'Date to be set';
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}
