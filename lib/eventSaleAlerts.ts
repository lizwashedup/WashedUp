import { supabase } from './supabase';
import { scopedTicketRequest } from './creatorTicketRead';
import type { CreatorPageScope } from './creatorPageReview';
const request = (scope: CreatorPageScope, name: string, args: Record<string, unknown>) => scopedTicketRequest(scope,()=>supabase.rpc(name,args));
export interface SaleAlertPreference { eventId: string; userId: string; enabled: boolean; revision: string | null; updatedAt: string | null; deliveryReady: boolean; emailVerified?: boolean }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class SaleAlertAccessDenied extends Error {}
export function readSaleAlertPreference(value: unknown, eventId: string, userId: string): SaleAlertPreference {
 const s = value as SaleAlertPreference;
 if (!s || s.eventId !== eventId || s.userId !== userId || !uuid.test(eventId) || !uuid.test(userId)
   || typeof s.enabled !== 'boolean' || typeof s.deliveryReady !== 'boolean'
   || !(s.emailVerified === undefined || typeof s.emailVerified === 'boolean')
   || (s.deliveryReady && s.emailVerified !== true)
   || !(s.revision === null || typeof s.revision === 'string' && uuid.test(s.revision))
   || !(s.updatedAt === null || typeof s.updatedAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(s.updatedAt) && Number.isFinite(Date.parse(s.updatedAt)))
   || (s.revision === null) !== (s.updatedAt === null)) throw Error('Could not confirm your sale alert preference.');
 return {eventId:s.eventId,userId:s.userId,enabled:s.enabled,revision:s.revision,updatedAt:s.updatedAt,deliveryReady:s.deliveryReady,...(s.emailVerified === undefined ? {} : {emailVerified:s.emailVerified})};
}
export async function loadSaleAlertPreference(eventId: string, scope: CreatorPageScope): Promise<SaleAlertPreference> {
 if (!uuid.test(eventId)) throw Error('Invalid event.');
 const {data,error} = await request(scope,'get_event_sales_alert_preference',{p_event_id:eventId});
 if (error?.code === '42501') throw new SaleAlertAccessDenied();
 if (error) throw Error('Could not load your sale alert preference.');
 return readSaleAlertPreference(data,eventId,scope.userId);
}
export async function saveSaleAlertPreference(saved: SaleAlertPreference, enabled: boolean, scope: CreatorPageScope): Promise<SaleAlertPreference> {
 readSaleAlertPreference(saved,saved.eventId,scope.userId);
 if (typeof enabled !== 'boolean') throw Error('Choose a sale alert preference.');
 const {data,error} = await request(scope,'save_event_sales_alert_preference',{p_event_id:saved.eventId,p_revision:saved.revision,p_enabled:enabled});
 if (error?.code === '42501') throw new SaleAlertAccessDenied();
 if (error) throw Error('Your change could not be confirmed. Check its saved status.');
 const result = readSaleAlertPreference(data,saved.eventId,scope.userId);
 if (result.enabled !== enabled || result.revision === null) throw Error('Your change could not be confirmed. Check its saved status.');
 return result;
}

/** Readiness never substitutes an enabled preference for a verified recipient. */
export function saleAlertStatus(saved: SaleAlertPreference): string {
 if (saved.emailVerified === false) return saved.enabled
  ? 'Your preference is saved. Sale emails need a verified account email before they can arrive.'
  : 'Sale emails are off. A verified account email is required to receive them.';
 if (!saved.deliveryReady) return 'Sale emails are not active yet. You can save your preference now.';
 return saved.enabled ? 'Sale emails are on for your account.' : 'Sale emails are off for your account.';
}
