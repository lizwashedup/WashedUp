import { validEventCategories } from './eventCategories';
/** Atomic saves for one already-saved page event. Existing standalone paths stay separate. */
import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import type { OperatorEventFields } from './creatorEvents';
export interface PageEventSaveState {
  pageId: string; eventId: string; updatedAt: string; status: 'Draft' | 'Live' | 'Completed' | 'Cancelled';
  fields: OperatorEventFields; offerType: string; ticketCapacity: number | null; latitude: number | null; longitude: number | null; canManageTickets: boolean;
}
export interface PageEventSaveInput {
  fields: OperatorEventFields; offerType: string; ticketCapacity: number | null;
  latitude: number | null; longitude: number | null; expectedUpdatedAt: string;
}
export interface PageEventSaveReceipt extends PageEventSaveState { requestId: string; userId: string }
export class PageEventSaveConflict extends Error {
  readonly code = 'PT409';
  constructor() { super('This event changed. Check the saved event before continuing.'); }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function current(scope: CreatorPageScope) { if (!uuid(scope.userId) || !scope.isCurrent()) throw new CreatorPageScopeExpired(); }
function target(pageId: string, eventId: string, scope: CreatorPageScope) {
  current(scope); if (!uuid(pageId) || !uuid(eventId)) throw Error('This page event is unavailable.');
}
async function account(scope: CreatorPageScope) {
  current(scope); const { data, error } = await supabase.auth.getUser(); current(scope);
  if (error) throw error; if (data.user?.id !== scope.userId) throw new CreatorPageScopeExpired();
}
async function rpc(name: string, args: Record<string, unknown>, scope: CreatorPageScope): Promise<unknown> {
  await account(scope); const { data, error } = await supabase.rpc(name,args); await account(scope);
  if (error?.code === 'PT409') throw new PageEventSaveConflict(); if (error) throw error; return data;
}
const coordinate = (v: unknown, limit: number): v is number | null => v === null || typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
export function validPageEventSaveInput(v: unknown): v is PageEventSaveInput {
  if (!object(v) || !object(v.fields) || !timestamp(v.expectedUpdatedAt) || !['free_event','ticketed_event','course','drop_in'].includes(v.offerType as string)
    || !(v.ticketCapacity === null || Number.isInteger(v.ticketCapacity) && (v.ticketCapacity as number)>0 && (v.ticketCapacity as number)<=2147483647)
    || !coordinate(v.latitude,90) || !coordinate(v.longitude,180) || (v.latitude === null) !== (v.longitude === null)) return false;
  return validPageEventSaveFields(v.fields);
}
function validPageEventSaveFields(fields: unknown): fields is OperatorEventFields {
  if (!object(fields)) return false;
  return ['title','description','image_url','event_date','venue','venue_address','category','external_url','ticket_price','public_name'].every(k => typeof (fields as Record<string,unknown>)[k] === 'string')
    && (fields.description_blocks === undefined || fields.description_blocks === null || Array.isArray(fields.description_blocks))
    && (fields.confirmation_message === undefined || fields.confirmation_message === null || typeof fields.confirmation_message === 'string')
    && (fields.categories===undefined||validEventCategories(fields.categories))
    && !!fields.title && !!fields.category && typeof fields.pin_to_chat === 'boolean'
    && ['start_time','end_time'].every(k => fields && ((fields as Record<string,unknown>)[k] === null || timestamp((fields as Record<string,unknown>)[k])));
}
function state(raw: unknown, pageId: string, eventId: string): PageEventSaveState {
  if (!object(raw) || raw.page_id !== pageId || raw.event_id !== eventId || !timestamp(raw.updated_at)
    || !['Draft','Live','Completed','Cancelled'].includes(raw.status as string) || typeof raw.offer_type !== 'string'
    || !(raw.ticket_capacity === null || Number.isInteger(raw.ticket_capacity) && (raw.ticket_capacity as number)>0)
    || !validPageEventSaveFields(raw.fields) || !coordinate(raw.latitude,90) || !coordinate(raw.longitude,180) || (raw.latitude === null) !== (raw.longitude === null) || typeof raw.can_manage_tickets !== 'boolean') throw Error('The saved event settings could not be confirmed.');
  return { pageId, eventId, fields: raw.fields as unknown as OperatorEventFields, updatedAt: raw.updated_at, status: raw.status as PageEventSaveState['status'], offerType: raw.offer_type,
    ticketCapacity: raw.ticket_capacity as number | null, latitude: raw.latitude, longitude: raw.longitude, canManageTickets: raw.can_manage_tickets };
}
function receipt(raw: unknown, pageId: string, eventId: string, requestId: string, scope: CreatorPageScope): PageEventSaveReceipt {
  const saved = state(raw,pageId,eventId);
  if (!object(raw) || raw.request_id !== requestId || raw.user_id !== scope.userId) throw Error('The saved event attempt could not be confirmed.');
  return { ...saved, requestId, userId: scope.userId };
}
export async function getPageEventSaveState(pageId: string, eventId: string, scope: CreatorPageScope) {
  target(pageId,eventId,scope);
  return state(await rpc('get_creator_page_event_save_state',{p_page_id:pageId,p_event_id:eventId},scope),pageId,eventId);
}
export async function getPageEventSaveAttempt(pageId: string, eventId: string, requestId: string, scope: CreatorPageScope) {
  target(pageId,eventId,scope); if (!uuid(requestId)) throw Error('This save attempt is unavailable.');
  const raw = await rpc('get_creator_page_event_save_attempt',{p_page_id:pageId,p_event_id:eventId,p_request_id:requestId},scope);
  return raw === null ? null : receipt(raw,pageId,eventId,requestId,scope);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function pageEventSaveMatches(saved: PageEventSaveReceipt, input: PageEventSaveInput) {
  const actual=saved.fields, expected=input.fields;
  const textFields=['title','description','image_url','event_date','venue','venue_address','category','external_url','public_name'] as const;
  const sameTime=(a:string|null,b:string|null)=>a===null||b===null?a===b:Date.parse(a)===Date.parse(b);
  return saved.offerType === input.offerType && saved.ticketCapacity === input.ticketCapacity && saved.latitude === input.latitude && saved.longitude === input.longitude
    && (expected.categories===undefined || canonical(actual.categories)===canonical(expected.categories))
    && textFields.every(k=>actual[k]===expected[k].trim()) && actual.pin_to_chat===expected.pin_to_chat
    && sameTime(actual.start_time,expected.start_time) && sameTime(actual.end_time,expected.end_time)
    && (expected.ticket_price.trim()==='' ? actual.ticket_price==='' : Number(actual.ticket_price)===Number(expected.ticket_price))
    && (expected.description_blocks == null || canonical(actual.description_blocks)===canonical(expected.description_blocks))
    && (expected.confirmation_message == null || (actual.confirmation_message??'')===expected.confirmation_message.trim());
}

/** Persist the original request before calling. Missing RPC or unknown transport
 * never falls back to a sequence of partial writes or automatic publication. */
export async function savePageEvent(pageId: string, eventId: string, requestId: string, input: PageEventSaveInput, scope: CreatorPageScope) {
  target(pageId,eventId,scope); if (!uuid(requestId) || !validPageEventSaveInput(input)) throw Error('Check the complete event and offer settings.');
  const saved = receipt(await rpc('save_creator_page_event',{p_page_id:pageId,p_event_id:eventId,p_request_id:requestId,p_fields:input.fields,
    p_offer_type:input.offerType,p_ticket_capacity:input.ticketCapacity,p_latitude:input.latitude,p_longitude:input.longitude,p_expected_updated_at:input.expectedUpdatedAt},scope),pageId,eventId,requestId,scope);
  if (!pageEventSaveMatches(saved,input)) throw Error('The complete event save could not be confirmed.');
  return saved;
}
