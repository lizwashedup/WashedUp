import { supabase } from './supabase';
import { assertTicketVisit, canReadCreatorTickets, ticketReadAuthorization } from './creatorTicketRead';
import { getPaidTicketEventReadiness, getTiers, TIER_COUNT_MAX, TIER_NAME_MAX, TIER_DESCRIPTION_MAX, TIER_MIN_PAID_CENTS, TIER_MAX_CENTS, type TierDraft, type TicketTier } from './ticketing';
import type { CreatorPageScope } from './creatorPageReview';
const fields = ['name','description','price_cents','quantity_cap','per_order_min','per_order_max','visibility','sales_open_at','sales_close_at'] as const;
const columns='id,event_id,name,description,price_cents,quantity_cap,per_order_min,per_order_max,visibility,status,sales_open_at,sales_close_at,sort_order,opens_after_tier_id';
const equal=(key:string,a:unknown,b:unknown)=>key.endsWith('_at') && a && b ? new Date(String(a)).getTime()===new Date(String(b)).getTime() : a===b || a==null&&b==null;
export function tierDraftProblem(draft:TierDraft):string|null {
 if(!draft.name.trim()||draft.name.trim().length>TIER_NAME_MAX)return 'Give this ticket a name.';
 if(draft.description && draft.description.length>TIER_DESCRIPTION_MAX)return 'Shorten the ticket description.';
 if(!Number.isSafeInteger(draft.price_cents)||draft.price_cents<0||draft.price_cents>TIER_MAX_CENTS||(draft.price_cents>0&&draft.price_cents<TIER_MIN_PAID_CENTS))return 'Use a free ticket or a price from $5 to $10,000.';
 for(const v of [draft.quantity_cap,draft.per_order_min,draft.per_order_max])if(v!=null&&(!Number.isSafeInteger(v)||v<1))return 'Ticket quantities must be positive whole numbers.';
 if(draft.per_order_min<1||(draft.per_order_max!=null&&draft.per_order_min>draft.per_order_max)||(draft.quantity_cap!=null&&draft.per_order_min>draft.quantity_cap))return 'The minimum cannot exceed the ticket or order limit.';
 if(!['visible','hidden'].includes(draft.visibility))return 'Choose ticket visibility.';
 const dates=[draft.sales_open_at,draft.sales_close_at];if(dates.some(d=>d!=null&&!Number.isFinite(new Date(d).getTime())))return 'Check the ticket sales dates.';
 if(dates[0]&&dates[1]&&new Date(dates[1]).getTime()<=new Date(dates[0]).getTime())return 'Sales must close after they open.';
 return null;
}
/** Stable new ID; edited fields only. A missing acknowledgement is reconciled without another write. */
export async function saveCreatorTier(eventId:string,recordId:string,draft:TierDraft,baseline:TicketTier|null,scope:CreatorPageScope):Promise<TicketTier>{
 const problem=tierDraftProblem(draft);if(problem)throw Error(problem);
 const authorization=(await ticketReadAuthorization(scope))!;
 if(!await canReadCreatorTickets(eventId,scope))throw Error('This ticket cannot be edited with your current access.');
 const read=async()=>{assertTicketVisit(scope);const r=await supabase.from('ticket_tiers').select(columns).eq('event_id',eventId).eq('id',recordId).maybeSingle().setHeader('Authorization',authorization);assertTicketVisit(scope);if(r.error)throw r.error;return r.data as TicketTier|null;};
 const value=Object.fromEntries(fields.filter(k=>draft[k]!==undefined).map(k=>[k,draft[k]]));
 const matches=(row:TicketTier|null)=>!!row&&row.id===recordId&&row.event_id===eventId&&Object.entries(value).every(([key,v])=>equal(key,(row as unknown as Record<string,unknown>)[key],v));
 const prior=await read();if(matches(prior))return prior!;
 if(!baseline&&prior)throw Error('This ticket has a saved version. Reopen it before editing.');
 if(baseline&&(!prior||prior.id!==baseline.id||prior.event_id!==baseline.event_id||fields.some(key=>!equal(key,prior[key],baseline[key]))))throw Error('This ticket changed. Your draft is kept; reopen the saved ticket before editing it.');
 if(draft.price_cents>0){const readiness=await getPaidTicketEventReadiness(eventId,scope);if(!readiness.ok){const error=Object.assign(Error(readiness.message??'Check the event end time.'),{code:readiness.reason==='missing_end_time'?'event_end_time_required':'event_unavailable'});throw error;}}
 const existing=baseline?[]:await getTiers(eventId,true,scope);
 if(!baseline&&existing.length>=TIER_COUNT_MAX)throw Error('This event already has four ticket types.');
 assertTicketVisit(scope);
 try {
  let query=baseline?supabase.from('ticket_tiers').update(value).eq('event_id',eventId).eq('id',recordId):supabase.from('ticket_tiers').insert({id:recordId,event_id:eventId,...value,status:'draft',sort_order:existing.length});
  if(baseline)for(const key of fields){const v=baseline[key];query=v==null?query.is(key,null):query.eq(key,v);}
  const r=await query.select(columns).maybeSingle().setHeader('Authorization',authorization);assertTicketVisit(scope);
  if(!r.error&&matches(r.data as TicketTier|null))return r.data as TicketTier;
 } catch {assertTicketVisit(scope);}
 const saved=await read();if(matches(saved))return saved!;
 throw Error('The save could not be confirmed. Your draft is kept. Try again.');
}
