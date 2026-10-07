/** Versioned status actions reuse the existing event update and financial boundaries. */
import {sameEventSaveVersion} from './eventSaveVersion';
import { supabase } from './supabase';
import { CreatorPageScopeExpired, type CreatorPageScope } from './creatorPageReview';
export type PageEventStatus = 'Completed' | 'Cancelled';
export interface PageEventStatusInput { status: PageEventStatus; expectedUpdatedAt: string }
export interface PageEventStatusReceipt extends PageEventStatusInput {
  pageId: string; eventId: string; requestId: string; userId: string; updatedAt: string;
}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const time=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validPageEventStatusInput(v:unknown):v is PageEventStatusInput {
  if(!v||typeof v!=='object')return false;
  const r=v as PageEventStatusInput;return ['Completed','Cancelled'].includes(r.status)&&time(r.expectedUpdatedAt);
}
export async function assertPageEventStatusAccount(scope:CreatorPageScope) {
  const current=()=>{if(!scope.isCurrent()||!uuid(scope.userId))throw new CreatorPageScopeExpired();};
  current();const {data,error}=await supabase.auth.getUser();current();if(error)throw error;
  if(data.user?.id!==scope.userId)throw new CreatorPageScopeExpired();
}
async function call(pageId:string,eventId:string,requestId:string,input:PageEventStatusInput,scope:CreatorPageScope,write:boolean) {
  if(!uuid(pageId)||!uuid(eventId)||!uuid(requestId)||!validPageEventStatusInput(input))throw Error('This event action is unavailable.');
  await assertPageEventStatusAccount(scope);
  const {data,error}=await supabase.rpc(write?'set_creator_page_event_status':'get_creator_page_event_status_attempt',{
    p_page_id:pageId,p_event_id:eventId,p_request_id:requestId,...(write?{p_status:input.status,p_expected_updated_at:input.expectedUpdatedAt}:{})});
  await assertPageEventStatusAccount(scope);if(error)throw error;
  if(data===null&&!write)return null;
  if(!data||typeof data!=='object'||Array.isArray(data)||data.page_id!==pageId||data.event_id!==eventId||data.request_id!==requestId||data.user_id!==scope.userId||data.status!==input.status||!time(data.updated_at)||!time(data.expected_updated_at)||!sameEventSaveVersion(data.expected_updated_at,input.expectedUpdatedAt))throw Error('The event action could not be confirmed.');
  return {pageId,eventId,requestId,userId:scope.userId,status:input.status,updatedAt:data.updated_at,expectedUpdatedAt:data.expected_updated_at} as PageEventStatusReceipt;
}
export function getPageEventStatusAttempt(pageId:string,eventId:string,requestId:string,input:PageEventStatusInput,scope:CreatorPageScope) {
  return call(pageId,eventId,requestId,input,scope,false);
}
export async function setPageEventStatus(pageId:string,eventId:string,requestId:string,input:PageEventStatusInput,scope:CreatorPageScope) {
  return (await call(pageId,eventId,requestId,input,scope,true))!;
}
