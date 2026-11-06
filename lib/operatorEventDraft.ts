import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
import { requestWithDeadline } from './requestWithDeadline';
import type { OperatorEventFields } from './creatorEvents';
import { mediaUUID } from './creatorPageEventMedia';
import { validEventCategories } from './eventCategories';

/** Additive draft protocol, enabled only after the server advertises support. */
export interface OperatorDraftInput {
  fields: OperatorEventFields;
  communityId: string | null;
  offerType: 'free_event' | 'ticketed_event' | 'course' | 'drop_in';
  ticketCapacity: number | null;
  latitude: number | null;
  longitude: number | null;
}
export interface OperatorDraftReceipt {
  version: 1; requestId: string; userId: string; eventId: string; communityId: string | null;
  status: 'Draft'; offerType: OperatorDraftInput['offerType']; ticketCapacity: number | null;
  latitude: number | null; longitude: number | null; createdAt: string;
}
export type OperatorDraftCancellation = Omit<OperatorDraftReceipt, 'eventId' | 'status'> & { eventId:null; status:'Cancelled' };
export type OperatorDraftOutcome = OperatorDraftReceipt | OperatorDraftCancellation;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const coordinate=(v:unknown,max:number)=>v===null||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=max;
const offer=(v:unknown):v is OperatorDraftInput['offerType']=>typeof v==='string'&&['free_event','ticketed_event','course','drop_in'].includes(v);
const capacity=(v:unknown)=>v===null||typeof v==='number'&&Number.isInteger(v)&&v>0&&v<=2147483647;
const timestamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validOperatorDraftInput(value:unknown):value is OperatorDraftInput {
  if(!object(value)||!object(value.fields)||!(value.communityId===null||mediaUUID(value.communityId))||!offer(value.offerType)
    ||!capacity(value.ticketCapacity)||!coordinate(value.latitude,90)||!coordinate(value.longitude,180)||(value.latitude===null)!==(value.longitude===null))return false;
  const f=value.fields;
  if(Object.keys(f).some(k=>!['title','description','image_url','event_date','start_time','end_time','venue','venue_address','category','categories','external_url','ticket_price','public_name','pin_to_chat','description_blocks','confirmation_message'].includes(k)))return false;
  return ['title','description','image_url','event_date','venue','venue_address','category','external_url','ticket_price','public_name'].every(k=>typeof f[k]==='string')
    && !!(f.title as string).trim()&&(f.title as string).length<=120&&!!(f.category as string).trim()&&typeof f.pin_to_chat==='boolean'
    && ['start_time','end_time'].every(k=>f[k]===null||timestamp(f[k]))
    && (f.categories===undefined||validEventCategories(f.categories))
    && (f.description_blocks==null||Array.isArray(f.description_blocks))
    && (f.confirmation_message==null||typeof f.confirmation_message==='string');
}
function current(scope:CreatorPageScope){if(!mediaUUID(scope.userId)||!scope.isCurrent())throw new CreatorPageScopeExpired();}
async function rpc(name:string,args:Record<string,unknown>,scope:CreatorPageScope,milliseconds=12_000):Promise<unknown>{
  current(scope);
  const {data:session,error:sessionError}=await requestWithDeadline(supabase.auth.getSession(),12_000);
  current(scope);
  if(sessionError)throw sessionError;
  if(session.session?.user.id!==scope.userId||!session.session.access_token)throw new CreatorPageScopeExpired();
  const request=supabase.rpc(name,args).setHeader('Authorization',`Bearer ${session.session.access_token}`);
  current(scope);
  const {data,error}=await requestWithDeadline(request,milliseconds);
  current(scope);
  if(error)throw error;
  return data;
}
function receipt(raw:unknown,requestId:string,scope:CreatorPageScope):OperatorDraftOutcome {
  if(!object(raw)||raw.version!==1||raw.request_id!==requestId||raw.user_id!==scope.userId||(raw.status==='Draft'?!mediaUUID(raw.event_id):raw.status!=='Cancelled'||raw.event_id!==null)
    ||!(raw.community_id===null||mediaUUID(raw.community_id))||!offer(raw.offer_type)||!capacity(raw.ticket_capacity)
    ||!coordinate(raw.latitude,90)||!coordinate(raw.longitude,180)||(raw.latitude===null)!==(raw.longitude===null)||!timestamp(raw.created_at)){
    throw Error('The original draft save could not be confirmed. Check the same save attempt before continuing.');
  }
  return {version:1,requestId,userId:scope.userId,eventId:raw.event_id,communityId:raw.community_id as string|null,status:raw.status,
    offerType:raw.offer_type,ticketCapacity:raw.ticket_capacity as number|null,latitude:raw.latitude as number|null,longitude:raw.longitude as number|null,createdAt:raw.created_at as string} as OperatorDraftOutcome;
}
export async function hasOperatorDraftProtocol(scope:CreatorPageScope){
  try{
    const version=await rpc('get_operator_event_draft_capability',{},scope);
    if(version!==1)throw Error('This draft recovery version is unavailable.');
    return true;
  }
  catch(error){if(object(error)&&error.code==='PGRST202')return false;throw error;}
}
export function operatorDraftReceiptMatches(saved:OperatorDraftOutcome,input:OperatorDraftInput){
  return saved.communityId===input.communityId&&saved.offerType===input.offerType&&saved.ticketCapacity===input.ticketCapacity
    &&saved.latitude===input.latitude&&saved.longitude===input.longitude;
}
/** Caller must durably store the request ID and immutable input BEFORE dispatch.
 * A deadline, malformed receipt or network failure must retain that same attempt.
 * There is no automatic retry and no fallback to the older non-idempotent writer.
 */
export async function createOperatorDraft(requestId:string,input:OperatorDraftInput,scope:CreatorPageScope){
  current(scope);if(!mediaUUID(requestId)||!validOperatorDraftInput(input))throw Error('Check the draft and RSVP settings.');
  const snapshot=JSON.parse(JSON.stringify(input)) as OperatorDraftInput;
  const saved=receipt(await rpc('create_operator_event_draft',{p_request_id:requestId,p_fields:snapshot.fields,p_community_id:snapshot.communityId,
    p_offer_type:snapshot.offerType,p_ticket_capacity:snapshot.ticketCapacity,p_latitude:snapshot.latitude,p_longitude:snapshot.longitude},scope,25_000),requestId,scope);
  if(!operatorDraftReceiptMatches(saved,snapshot))throw Error('The saved draft settings do not match this attempt. Check the original save.');
  return saved;
}
export async function cancelOperatorDraftAttempt(requestId:string,input:OperatorDraftInput,scope:CreatorPageScope){
  current(scope);if(!mediaUUID(requestId)||!validOperatorDraftInput(input))throw Error('Check the original draft details.');
  const snapshot=JSON.parse(JSON.stringify(input)) as OperatorDraftInput;
  const saved=receipt(await rpc('cancel_operator_event_draft_attempt',{p_request_id:requestId,p_input:{fields:snapshot.fields,community_id:snapshot.communityId,offer_type:snapshot.offerType,ticket_capacity:snapshot.ticketCapacity,latitude:snapshot.latitude,longitude:snapshot.longitude}},scope,25_000),requestId,scope);
  if(!operatorDraftReceiptMatches(saved,snapshot))throw Error('Check the original draft save.');
  return saved;
}
/** Null means no receipt yet, never proof that an earlier request cannot arrive.
 * Any deliberate retry must use the same request ID and stored input.
 */
export async function getOperatorDraftAttempt(requestId:string,scope:CreatorPageScope){
  current(scope);if(!mediaUUID(requestId))throw Error('This draft attempt is unavailable.');
  const raw=await rpc('get_operator_event_draft_attempt',{p_request_id:requestId},scope);
  return raw===null?null:receipt(raw,requestId,scope);
}
