import { supabase } from './supabase';
import { scopedTicketRequest } from './creatorTicketRead';
import type { CreatorPageScope } from './creatorPageReview';
import { messageUuid } from './attendeeMessageContract';

export interface ReminderChoices { dayBeforeOn: boolean; dayOfOn: boolean }
export interface ReminderDelivery { timing: 'day_before' | 'day_of'; queuedCount: number; stoppedCount: number; lastQueuedAt: string }
export interface ReminderSettings extends ReminderChoices {
  eventId: string; pageId: string; revision: string | null; updatedAt: string | null;
  startsAt: string | null; eventStatus: string; deliveryReady: boolean; deliverySummary?: ReminderDelivery[];
}
export interface ReminderDraft extends ReminderChoices {
  pageId?: string; baseRevision?: string | null;
}
export function validReminderDraft(value: unknown): value is ReminderDraft {
  const v = value as ReminderDraft;
  return !!v && !Array.isArray(v) && typeof v.dayBeforeOn === 'boolean' && typeof v.dayOfOn === 'boolean'
    && (v.pageId === undefined || typeof v.pageId === 'string' && messageUuid.test(v.pageId))
    && (v.baseRevision === undefined || v.baseRevision === null || typeof v.baseRevision === 'string' && messageUuid.test(v.baseRevision));
}
const validTime = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
function validDeliverySummary(value: unknown): value is ReminderDelivery[] {
  return Array.isArray(value) && value.length <= 2 && new Set(value.map(d=>d?.timing)).size === value.length
    && value.every(d=>d && ['day_before','day_of'].includes(d.timing) && Number.isSafeInteger(d.queuedCount) && d.queuedCount > 0
      && Number.isSafeInteger(d.stoppedCount) && d.stoppedCount >= 0 && d.stoppedCount <= d.queuedCount && validTime(d.lastQueuedAt));
}
export function reminderDeliveryCopy(settings: ReminderSettings, now = Date.now()) {
  if (!['Draft','Live'].includes(settings.eventStatus) || settings.startsAt && Date.parse(settings.startsAt) <= now) return 'No new reminders will be queued for this event.';
  if (!settings.deliveryReady) return 'Automatic reminders are paused. You can save your settings now; no new reminders will be queued while paused.';
  if (settings.eventStatus === 'Draft') return 'Publish this event before reminders can be queued.';
  if (!settings.dayBeforeOn && !settings.dayOfOn) return 'Both reminders are off in your saved settings.';
  return 'Reminders use your saved settings and current attendee preferences.';
}
export function readReminderSettings(value: unknown, eventId: string): ReminderSettings | null {
  const r = value as ReminderSettings;
  if (!validReminderDraft(r) || r.eventId !== eventId || !messageUuid.test(eventId) || typeof r.pageId !== 'string' || !messageUuid.test(r.pageId)
    || !(r.revision === null || typeof r.revision === 'string' && messageUuid.test(r.revision))
    || !(r.updatedAt === null || validTime(r.updatedAt)) || (r.revision === null) !== (r.updatedAt === null)
    || !(r.startsAt === null || validTime(r.startsAt)) || !['Draft','Live','Cancelled','Completed'].includes(r.eventStatus)
    || typeof r.deliveryReady !== 'boolean' || (r.deliverySummary !== undefined && !validDeliverySummary(r.deliverySummary))) return null;
  return {eventId:r.eventId,pageId:r.pageId,revision:r.revision,updatedAt:r.updatedAt,startsAt:r.startsAt,
    eventStatus:r.eventStatus,deliveryReady:r.deliveryReady,dayBeforeOn:r.dayBeforeOn,dayOfOn:r.dayOfOn,
    ...(r.deliverySummary ? {deliverySummary:r.deliverySummary.map(d=>({timing:d.timing,queuedCount:d.queuedCount,stoppedCount:d.stoppedCount,lastQueuedAt:d.lastQueuedAt}))} : {})};
}
export class ReminderAccessDenied extends Error {}
export class ReminderConflict extends Error {}
export class ReminderRejected extends Error {}
export async function loadEventReminders(eventId: string, scope: CreatorPageScope) {
  if (!messageUuid.test(eventId)) throw Error('Invalid event.');
  const {data,error} = await scopedTicketRequest(scope,()=>supabase.rpc('get_event_reminder_settings',{p_event_id:eventId}));
  if (error?.code === '42501') throw new ReminderAccessDenied('Reminder access is no longer available.');
  const result = !error && readReminderSettings(data,eventId);
  if (!result) throw Error('Couldn’t load saved reminders. Your draft is kept.');
  return result;
}
export async function saveEventReminders(eventId: string, baseline: ReminderSettings, value: ReminderChoices, scope: CreatorPageScope) {
  if (!readReminderSettings(baseline,eventId) || !validReminderDraft(value)) throw Error('Invalid reminder settings.');
  const {data,error} = await scopedTicketRequest(scope,()=>supabase.rpc('save_event_reminder_settings',{
    p_event_id:eventId,p_page_id:baseline.pageId,p_revision:baseline.revision,
    p_day_before_on:value.dayBeforeOn,p_day_of_on:value.dayOfOn,
  }));
  if (error?.code === '42501') throw new ReminderAccessDenied('Reminder access is no longer available.');
  if (error?.code === 'P0001' && error.message === 'Reminder settings changed. Review the saved settings first.') throw new ReminderConflict('The saved settings changed. Check them before saving.');
  if (error?.code === 'P0001' && error.message === 'This event no longer accepts reminder changes')
    throw new ReminderRejected('This event no longer accepts reminder changes.');
  const result = !error && readReminderSettings(data,eventId);
  if (!result || result.pageId !== baseline.pageId || result.revision === null
    || result.dayBeforeOn !== value.dayBeforeOn || result.dayOfOn !== value.dayOfOn)
    throw Error('The save could not be confirmed. Check saved settings before trying again.');
  return result;
}
export function sameReminderChoices(a: ReminderChoices,b: ReminderChoices) {
  return a.dayBeforeOn === b.dayBeforeOn && a.dayOfOn === b.dayOfOn;
}
