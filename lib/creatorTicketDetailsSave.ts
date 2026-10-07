import { supabase } from './supabase';
import { assertTicketVisit, canReadCreatorTickets, ticketReadAuthorization } from './creatorTicketRead';
import type { CreatorPageScope } from './creatorPageReview';
import type { PromoDraft } from './ticketPromosAddons';
import { FAQ_QUESTION_MAX, FAQ_ANSWER_MAX } from './ticketing';

async function insertDetail(table:'ticket_promo_codes'|'event_faqs',eventId:string,id:string,value:Record<string,unknown>,scope:CreatorPageScope):Promise<Record<string,unknown>> {
 const authorization=(await ticketReadAuthorization(scope))!;
 if(!await canReadCreatorTickets(eventId,scope))throw Error('Your access to manage this event could not be confirmed.');
 const columns=['id','event_id',...Object.keys(value)].join(',');
 const read=async()=>{assertTicketVisit(scope);const r=await supabase.from(table).select(columns).eq('event_id',eventId).eq('id',id).maybeSingle().setHeader('Authorization',authorization);assertTicketVisit(scope);if(r.error)throw r.error;return r.data as unknown as Record<string,unknown>|null;};
 const matches=(row:Record<string,unknown>|null)=>!!row&&row.id===id&&row.event_id===eventId&&Object.entries(value).every(([key,v])=>key.endsWith('_at')&&v&&row[key]?new Date(String(v)).getTime()===new Date(String(row[key])).getTime():row[key]===v);
 const previous=await read();if(matches(previous))return previous!;
 if(previous)throw Error('An earlier version is saved. Discard this draft and check the saved item.');
 assertTicketVisit(scope);let duplicate=false;
 try {
  const r=await supabase.from(table).insert({id,event_id:eventId,...value}).select(columns).maybeSingle().setHeader('Authorization',authorization);assertTicketVisit(scope);
  if(!r.error&&matches(r.data as unknown as Record<string,unknown>|null))return r.data as unknown as Record<string,unknown>;
  duplicate=r.error?.code==='23505';
 } catch {assertTicketVisit(scope);}
 const saved=await read();if(matches(saved))return saved!;
 if(duplicate&&table==='ticket_promo_codes')throw Error('That code already exists for this event. Use a different code.');
 throw Error('The save could not be confirmed. Your draft is kept. Try again.');
}
export function promoDraftProblem(draft:PromoDraft):string|null {
 if(!draft.code.trim()||draft.code.trim().length>40)return 'Give the code a name, up to 40 characters.';
 if(!['percent','flat'].includes(draft.discount_type)||!Number.isSafeInteger(draft.discount_value)||draft.discount_value<1)return 'Use a positive whole percent or a dollar amount with up to two decimal places.';
 if(draft.discount_type==='percent'&&draft.discount_value>100)return 'A percent tops out at 100.';
 if(draft.max_uses!==null&&(!Number.isSafeInteger(draft.max_uses)||draft.max_uses<1))return 'Uses must be a positive whole number.';
 if([draft.starts_at,draft.ends_at].some(d=>d!==null&&!Number.isFinite(new Date(d).getTime())))return 'Check the code’s dates.';
 if(draft.starts_at&&draft.ends_at&&new Date(draft.ends_at).getTime()<=new Date(draft.starts_at).getTime())return 'The code must end after it starts.';
 return null;
}
export async function saveCreatorPromo(eventId:string,id:string,draft:PromoDraft,scope:CreatorPageScope):Promise<{id:string;event_id:string}>{
 const problem=promoDraftProblem(draft);if(problem)throw Error(problem);
 return await insertDetail('ticket_promo_codes',eventId,id,{...draft,code:draft.code.trim().toUpperCase()},scope) as unknown as {id:string;event_id:string};
}
export async function saveCreatorFaq(eventId:string,id:string,question:string,answer:string,sortOrder:number,scope:CreatorPageScope):Promise<{id:string;event_id:string}>{
 const q=question.trim(),a=answer.trim();
 if(!q||q.length>FAQ_QUESTION_MAX||!a||a.length>FAQ_ANSWER_MAX)throw Error('Add a question and answer within the displayed limits.');
 return await insertDetail('event_faqs',eventId,id,{question:q,answer:a,sort_order:sortOrder,is_active:true},scope) as unknown as {id:string;event_id:string};
}
