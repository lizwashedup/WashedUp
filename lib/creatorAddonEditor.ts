import { supabase } from './supabase';
import type { CreatorPageScope } from './creatorPageReview';
import type { AddonDraft, AddonVariation, EventAddon } from './ticketPromosAddons';
export type CreatorAddon = EventAddon & {variations: AddonVariation[]};
export class CreatorAddonRejected extends Error {}
export class CreatorAddonChanged extends Error {
 constructor(public saved:CreatorAddon|null){super('This extra changed after editing began. Your draft is kept.');}
}
export interface CreatorAddonDispatch {previouslyDispatched:boolean;beforeDispatch:()=>Promise<boolean>}
const columns='id,event_id,name,description,image_url,price_cents,quantity_cap,per_order_max,sales_open_at,sales_close_at,sold_count,status,variations';
const current=(scope:CreatorPageScope)=>{if(!scope.isCurrent())throw Error('This editing visit is no longer active.');};
async function token(scope:CreatorPageScope){
 current(scope);const result=await supabase.auth.getSession();current(scope);
 if(result.error||result.data.session?.user.id!==scope.userId||!result.data.session.access_token)throw Error('Check your sign-in before saving.');
 return result.data.session.access_token;
}
export function addonOptionsProblem(options:AddonVariation[]):string|null {
 if(!Array.isArray(options))return 'This extra’s options could not be read.';
 if(options.length>20)return 'Use up to 20 options.';
 if(options.some(o=>!o||typeof o.id!=='string'||typeof o.label!=='string'||!o.id.trim()||o.id!==o.id.trim()||o.id.length>128||!o.label.trim()||o.label.trim().length>120))return 'Give each option a name (up to 120 characters).';
 if(new Set(options.map(o=>o.id)).size!==options.length)return 'Each option needs its own ID.';
 return null;
}
async function read(eventId:string,id:string,authorization:string,scope:CreatorPageScope){
 current(scope);const result=await supabase.from('event_add_ons').select(columns).eq('event_id',eventId).eq('id',id).maybeSingle().setHeader('Authorization',`Bearer ${authorization}`);current(scope);
 if(result.error)throw result.error;
 return result.data as CreatorAddon|null;
}
export async function loadCreatorAddon(eventId:string,id:string,scope:CreatorPageScope){
 const row=await read(eventId,id,await token(scope),scope);
 if(!row||row.event_id!==eventId||row.id!==id||!Array.isArray(row.variations)||addonOptionsProblem(row.variations))throw Error('This extra could not be loaded.');
 return row;
}
/** Stable client ID keeps an uncertain new save recoverable; original row and options save atomically. */
export async function saveCreatorAddon(eventId:string,id:string,draft:AddonDraft,isNew:boolean,scope:CreatorPageScope,write=true,baseline?:CreatorAddon|null,dispatch?:CreatorAddonDispatch):Promise<CreatorAddon>{
 const problem=addonOptionsProblem(draft.variations??[]);if(problem)throw Error(problem);
 const value={...draft,variations:(draft.variations??[]).map(o=>({id:o.id,label:o.label.trim()}))};
 const authorization=await token(scope);
 const matches=(row:CreatorAddon|null)=>!!row&&row.id===id&&row.event_id===eventId&&Object.entries(value).every(([key,v])=>JSON.stringify((row as unknown as Record<string,unknown>)[key])===JSON.stringify(v));
 const sameBaseline=(row:CreatorAddon|null)=>!!baseline&&!!row&&row.id===baseline.id&&row.event_id===baseline.event_id&&Object.keys(value).every(key=>JSON.stringify((row as unknown as Record<string,unknown>)[key])===JSON.stringify((baseline as unknown as Record<string,unknown>)[key]));
 if(!write||baseline||isNew){
  const prior=await read(eventId,id,authorization,scope);if(matches(prior))return prior!;
  if(isNew?!!prior:baseline&&!sameBaseline(prior)){
   if(dispatch?.previouslyDispatched===false)throw new CreatorAddonChanged(prior);
   throw Error('This extra changed and has a different saved version. Reopen it before editing; the original save still needs to be checked.');
  }
  if(!write)throw Error('The save is not confirmed yet. Retry the original save when ready.');
 }
 if(dispatch&&!await dispatch.beforeDispatch())throw Error('Keep the original save on this device before trying again.');
 current(scope);
 let row:CreatorAddon|null=null,rejected=false,unapplied=false;
 try {
  const query=isNew?supabase.from('event_add_ons').insert({id,event_id:eventId,...value}):supabase.from('event_add_ons').update(value).eq('event_id',eventId).eq('id',id);
  if(!isNew&&baseline){for(const key of Object.keys(value)){const previous=(baseline as unknown as Record<string,unknown>)[key];if(previous===null)query.is(key,null);else query.eq(key,key==='variations'?JSON.stringify(previous):previous);}}
  const result=await query.select(columns).maybeSingle().setHeader('Authorization',`Bearer ${authorization}`);current(scope);
  if(!result.error)row=result.data as CreatorAddon|null;
  unapplied=!isNew&&!!baseline&&!result.error&&result.data===null;
  rejected=typeof result.error?.code==='string'&&(/^23/.test(result.error.code)||result.error.code==='P0001');
 }catch{current(scope);}
 if(matches(row))return row!;
 // A committed insert/update may have lost its response. Never issue another write here.
 row=await read(eventId,id,authorization,scope);if(matches(row))return row!;
 if(unapplied&&dispatch?.previouslyDispatched===false&&!sameBaseline(row))throw new CreatorAddonChanged(row);
 if(rejected&&dispatch?.previouslyDispatched===false&&(isNew?row===null:sameBaseline(row)))throw new CreatorAddonRejected(row&&value.quantity_cap!==null&&value.quantity_cap<row.sold_count?'Available quantity can’t be below the number already reserved. Increase it and try again.':'This extra couldn’t be saved. Review the price, quantity and options, then try again.');
 throw Error('The save could not be confirmed. Your draft is kept. Try again.');
}
